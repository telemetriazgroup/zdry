import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export function stripAudioCopyArgs(input: string, output: string) {
  return ["-y", "-i", input, "-c:v", "copy", "-an", "-movflags", "+faststart", output];
}

export function stripAudioEncodeArgs(input: string, output: string) {
  return ["-y", "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an", "-movflags", "+faststart", output];
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-500) || `ffmpeg salió ${code}`));
    });
  });
}

/** Quita el audio. Si ffmpeg no está o falla, devuelve el original. */
export async function stripVideoAudio(input: Buffer, ext = "mp4"): Promise<{ buffer: Buffer; mime: string; stripped: boolean }> {
  const safeExt = ["mp4", "webm", "mov"].includes(String(ext || "").toLowerCase()) ? String(ext).toLowerCase() : "mp4";
  const dir = await mkdtemp(join(tmpdir(), "zdry-vid-"));
  const inPath = join(dir, `in.${safeExt}`);
  const outPath = join(dir, "out.mp4");
  await writeFile(inPath, input);
  try {
    try {
      await runFfmpeg(stripAudioCopyArgs(inPath, outPath));
    } catch {
      await runFfmpeg(stripAudioEncodeArgs(inPath, outPath));
    }
    const buffer = await readFile(outPath);
    if (!buffer.length) return { buffer: input, mime: "video/mp4", stripped: false };
    return { buffer, mime: "video/mp4", stripped: true };
  } catch {
    return { buffer: input, mime: safeExt === "webm" ? "video/webm" : "video/mp4", stripped: false };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mediaExtension, zipStored } from "./zip-store";

describe("zipStored", () => {
  it("empaqueta fotos y video para abrirlos después", () => {
    const zip = zipStored([
      { name: "foto-1.jpg", data: Buffer.from("jpeg-bytes") },
      { name: "video.mp4", data: Buffer.from("mp4-bytes") },
    ]);
    const dir = mkdtempSync(join(tmpdir(), "zdry-zip-"));
    const file = join(dir, "paquete.zip");
    writeFileSync(file, zip);
    const out = execFileSync("python3", ["-c", `
import zipfile
z = zipfile.ZipFile(${JSON.stringify(file)})
print(z.read("foto-1.jpg").decode())
print(z.read("video.mp4").decode())
`], { encoding: "utf8" });
    expect(out).toBe("jpeg-bytes\nmp4-bytes\n");
  });

  it("elige la extensión según el tipo de archivo", () => {
    expect(mediaExtension("image/jpeg", "jpg")).toBe("jpg");
    expect(mediaExtension("video/mp4", "mp4")).toBe("mp4");
    expect(mediaExtension("", "jpg")).toBe("jpg");
  });
});

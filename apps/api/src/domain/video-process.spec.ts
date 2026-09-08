import { stripAudioCopyArgs, stripAudioEncodeArgs } from "./video-process";

describe("video process", () => {
  it("copia video y quita pista de audio", () => {
    const args = stripAudioCopyArgs("/tmp/in.mp4", "/tmp/out.mp4");
    expect(args).toContain("-an");
    expect(args).toContain("-c:v");
    expect(args).toContain("copy");
  });

  it("el fallback recodifica sin audio", () => {
    const args = stripAudioEncodeArgs("/tmp/in.mp4", "/tmp/out.mp4");
    expect(args).toContain("-an");
    expect(args).toContain("libx264");
  });
});

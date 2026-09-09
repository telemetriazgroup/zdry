import { stripAudioEncodeArgs } from "./video-process";

describe("video process", () => {
  it("recodifica solo video y quita audio", () => {
    const args = stripAudioEncodeArgs("/tmp/in.mp4", "/tmp/out.mp4");
    expect(args).toContain("-an");
    expect(args).toContain("libx264");
    expect(args).toContain("0:v:0");
    expect(args).not.toContain("copy");
  });
});

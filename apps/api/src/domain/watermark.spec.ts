import Jimp from "jimp";
import { applyCatalogWatermark, PUBLIC_PHOTO_H, PUBLIC_PHOTO_W } from "./watermark";

describe("applyCatalogWatermark", () => {
  it("fits the photo to the public catalog canvas and tiles the default mark", async () => {
    const img = new Jimp(200, 320, 0xff0000ff);
    const src = await img.getBufferAsync(Jimp.MIME_JPEG);
    const out = await applyCatalogWatermark(src, null);
    expect(out.mime).toBe("image/jpeg");
    const pub = await Jimp.read(out.buffer);
    expect(pub.getWidth()).toBe(PUBLIC_PHOTO_W);
    expect(pub.getHeight()).toBe(PUBLIC_PHOTO_H);
    expect(out.buffer.equals(src)).toBe(false);
  }, 20000);

  it("stretches a landscape photo to fill the public canvas", async () => {
    const img = new Jimp(400, 220, 0xcc2200ff);
    const src = await img.getBufferAsync(Jimp.MIME_JPEG);
    const blank = await new Jimp(1, 1, 0x00000000).getBufferAsync(Jimp.MIME_PNG);
    const out = await applyCatalogWatermark(src, blank);
    const pub = await Jimp.read(out.buffer);
    expect(pub.getWidth()).toBe(PUBLIC_PHOTO_W);
    expect(pub.getHeight()).toBe(PUBLIC_PHOTO_H);
    const corner = Jimp.intToRGBA(pub.getPixelColor(4, 4));
    expect(corner.r).toBeGreaterThan(160);
    expect(corner.b).toBeLessThan(80);
  }, 20000);
});

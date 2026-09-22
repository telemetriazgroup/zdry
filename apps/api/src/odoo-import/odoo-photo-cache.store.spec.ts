import { presentCachedPhotos } from "./odoo-photo-cache.store";

describe("odoo photo cache", () => {
  it("presenta adjuntos locales con el mismo id de Odoo", () => {
    const photos = presentCachedPhotos([
      { odooAttId: 88, originalName: "frente.jpg", mimeType: "image/jpeg", sizeBytes: 1200, kind: "inbox" },
      { odooAttId: 91, originalName: "cara-zdry.jpg", mimeType: "image/jpeg", sizeBytes: 800, kind: "zdry_ref" },
    ]);
    expect(photos).toEqual([
      { id: 88, name: "frente.jpg", mimetype: "image/jpeg", size: 1200, kind: "inbox", local: true },
      { id: 91, name: "cara-zdry.jpg", mimetype: "image/jpeg", size: 800, kind: "zdry_ref", local: true },
    ]);
  });
});

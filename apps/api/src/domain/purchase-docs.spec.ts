import { sniffPurchaseDocMime, extForMime, isPurchaseDocKind } from "./purchase-docs";

describe("documentos de compra", () => {
  it("reconoce PDF e imágenes por firma", () => {
    expect(sniffPurchaseDocMime(Buffer.from("%PDF-1.4 more-bytes"))).toBe("application/pdf");
    expect(sniffPurchaseDocMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]))).toBe("image/jpeg");
    expect(sniffPurchaseDocMime(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(12)]))).toBe("image/png");
  });

  it("rechaza binarios que no son PDF ni imagen", () => {
    expect(() => sniffPurchaseDocMime(Buffer.from("PK\x03\x04not-a-pdf!!"))).toThrow(/Solo se aceptan PDF/);
  });

  it("extensión y tipo de documento", () => {
    expect(extForMime("application/pdf")).toBe("pdf");
    expect(isPurchaseDocKind("factura")).toBe(true);
    expect(isPurchaseDocKind("exe")).toBe(false);
  });
});

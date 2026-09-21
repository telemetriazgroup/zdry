import {
  decodeOdooPdf,
  isPdfBuffer,
  pdfLooksLikePeruV2,
  presupuestoFilename,
  quotePdfStorageKey,
} from "./odoo-quote-pdf";

function miniPdf(text: string): Buffer {
  return Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\nstream\n${text}\nendstream\n%%EOF\n`, "latin1");
}

describe("odoo-quote-pdf Q3", () => {
  it("reconoce magic %PDF y decodifica el tuple JSON-RPC", () => {
    const pdf = miniPdf("COTIZACIÓN N°: 10020263830");
    expect(isPdfBuffer(pdf)).toBe(true);
    expect(decodeOdooPdf([pdf.toString("base64"), "pdf"]).equals(pdf)).toBe(true);
    expect(decodeOdooPdf(pdf.toString("base64")).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("exige COTIZACIÓN y el name de la SO (texto sin comprimir)", () => {
    const pdf = miniPdf("COTIZACIÓN N°: 10020263830");
    expect(pdfLooksLikePeruV2(pdf, "10020263830").ok).toBe(true);
    expect(pdfLooksLikePeruV2(miniPdf("hello"), "10020263830").missing).toEqual(
      expect.arrayContaining(["COTIZACIÓN", "name"]),
    );
    expect(isPdfBuffer(Buffer.from("not-a-pdf"))).toBe(false);
  });

  it("nombra el archivo como Odoo ES y la clave MinIO por quote", () => {
    expect(presupuestoFilename("10020263830")).toBe("Presupuesto - 10020263830.pdf");
    expect(quotePdfStorageKey("q1", "10020263830")).toBe("quotes/q1/presupuesto-10020263830.pdf");
  });
});

import {
  classifyDryFile,
  fileFromOdoo,
  headerExtraFromOdoo,
  invoiceFromOdoo,
  invoiceKind,
  lineFromOdoo,
  notesFromSaleMessages,
  paymentStateFromInvoices,
  pickingFromOdoo,
  pickingKind,
  stripMailHtml,
} from "./odoo-dry-dossier";

describe("odoo-dry-dossier", () => {
  it("parte líneas de venta DRY con serie Studio", () => {
    const line = lineFromOdoo({
      id: 99,
      product_id: [270, "CONTENEDOR DRY 40 HC SEGUNDO USO"],
      name: "CONTENEDOR DRY 40 HC SEGUNDO USO",
      product_uom_qty: 1,
      qty_delivered: 0,
      qty_invoiced: 0,
      price_unit: 1750,
      price_subtotal: 1750,
      discount: 0,
      x_studio_tipo: "venta",
      x_studio_equipo: "ZCSU4012782",
    });
    expect(line.qty).toBe(1);
    expect(line.priceUnit).toBe(1750);
    expect(line.studioEquipo).toBe("ZCSU4012782");
  });

  it("distingue OUT, IN y factura / NC", () => {
    expect(pickingKind("outgoing")).toBe("picking_out");
    expect(pickingKind("incoming")).toBe("picking_in");
    expect(invoiceKind("out_invoice")).toBe("invoice");
    expect(invoiceKind("out_refund")).toBe("refund");
    const out = pickingFromOdoo({ id: 1, name: "ZGROU/OUT/0100", state: "done", picking_type_code: "outgoing" }, ["ZCSU4012782"]);
    expect(out.kind).toBe("picking_out");
    expect(out.summary).toContain("Salida");
    const inv = invoiceFromOdoo({
      id: 2,
      name: "F F00-1",
      move_type: "out_invoice",
      state: "posted",
      payment_state: "not_paid",
      amount_total: 2065,
      currency_id: [1, "USD"],
      invoice_date: "2026-09-15",
    });
    expect(inv.kind).toBe("invoice");
    expect(inv.amount).toBe(2065);
  });

  it("limpia HTML del chatter y descarta vacíos", () => {
    expect(stripMailHtml("<p>Quotation created</p>")).toBe("Quotation created");
    const notes = notesFromSaleMessages([
      { id: 1, body: "<p>Cotización enviada</p>", author_id: [8, "Melisa Garay"], date: "2026-09-15 16:00:00", message_type: "notification" },
      { id: 2, body: "<p></p>", author_id: [8, "Melisa Garay"], message_type: "comment" },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].author).toBe("Melisa Garay");
    expect(notes[0].body).toBe("Cotización enviada");
  });

  it("agrega cabecera y estado de cobro", () => {
    const extra = headerExtraFromOdoo({
      payment_term_id: [3, "Pago inmediato"],
      warehouse_id: [1, "CALLAO"],
      opportunity_id: [10, "10020263800"],
      note: "<p>https://www.zgroup.com.pe</p>",
      amount_tax: 315,
    });
    expect(extra.warehouse).toBe("CALLAO");
    expect(extra.note).toContain("zgroup");
    expect(paymentStateFromInvoices([
      { kind: "invoice", paymentState: "paid" } as never,
      { kind: "invoice", paymentState: "paid" } as never,
    ])).toBe("paid");
  });

  it("clasifica imagen y PDF; ignora basura", () => {
    expect(classifyDryFile("coti.jpg", "image/jpeg")).toBe("image");
    expect(classifyDryFile("proforma.pdf", "application/pdf")).toBe("document");
    expect(classifyDryFile("script.js", "application/javascript")).toBeNull();
    expect(fileFromOdoo({ id: 9, name: "plano.pdf", mimetype: "application/pdf", file_size: 1200 })?.kind).toBe("document");
  });
});

import { pdfLooksLikePeruV2 } from "./odoo-quote-pdf";
import { renderPeruV2Pdf } from "./peru-v2-pdf";
import { buildPeruV2Report, moneyReport, peruV2Missing, reportAddress, ZGROUP_LETTERHEAD } from "./peru-v2-report";

describe("peru-v2-report", () => {
  const base = {
    number: "COT-2026-00007",
    odooSaleName: "10020263884",
    kind: "venta",
    createdAt: new Date("2026-09-21T15:00:00Z"),
    vendorName: "Eusebio Avellaneda",
    contactName: "Luis Marcelo",
    customer: {
      companyName: "NESTLE PERU S A",
      rucDni: "20263322496",
      email: "compras@nestle.pe",
      phone: "929467505",
      street: "CAL. LUIS GALVANI NRO 493 URB. LOTIZACION INDUSTRIAL SAN",
      district: "ATE",
      province: "LIMA",
      department: "LIMA",
    },
    lines: [{ iso: "CIMU2022411", type: "40HC", cat: "CW", priceNet: 3500 }],
  };

  it("mapea los bloques del PDF Odoo con SUNAT y número de SO", () => {
    const r = buildPeruV2Report(base);
    expect(r.saleName).toBe("10020263884");
    expect(r.reference).toBe("COT-2026-00007");
    expect(r.customerName).toBe("NESTLE PERU S A");
    expect(r.customerVat).toBe("20263322496");
    expect(r.quoteDate).toBe("09/21/2026");
    expect(r.validUntil).toBe("09/28/2026");
    expect(r.customerAddress).toBe(reportAddress(base.customer));
    expect(r.customerAddress).toMatch(/GALVANI/);
    expect(r.customerAddress).toMatch(/ATE-LIMA-Perú/);
    expect(r.contactName).toBe("Luis Marcelo");
    expect(r.contactPhone).toBe("929467505");
    expect(r.commercial).toBe("Eusebio Avellaneda");
    expect(r.asunto).toMatch(/VENTA DE CONTENEDOR DRY 40 HC SEGUNDO USO/);
    expect(r.lines[0]).toMatchObject({ iso: "CIMU2022411", priceFinal: 3500, qty: 1 });
    expect(r.letterhead.vat).toBe(ZGROUP_LETTERHEAD.vat);
    expect(r.letterhead.banks.length).toBe(6);
    expect(peruV2Missing(r)).toEqual([]);
    expect(moneyReport(3500)).toBe("3,500.00");
  });

  it("usa el número ZDRY si aún no hay SO Odoo", () => {
    const r = buildPeruV2Report({ ...base, odooSaleName: null });
    expect(r.saleName).toBe("COT-2026-00007");
  });

  it("renderiza un PDF con COTIZACIÓN y el número Odoo", async () => {
    const r = buildPeruV2Report(base);
    const buf = await renderPeruV2Pdf(r);
    expect(pdfLooksLikePeruV2(buf, "10020263884").ok).toBe(true);
    expect(buf.length).toBeGreaterThan(2000);
  });
});

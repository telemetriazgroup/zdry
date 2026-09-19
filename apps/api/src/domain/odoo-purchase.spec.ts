import { applySerialTextRefs, assignRefsBySharedMove, parseCondition, parseSerialsFromPoText, purchaseRefFromOrder } from "./odoo-purchase";

describe("odoo-purchase", () => {
  it("extrae seriales del texto libre de la línea OC", () => {
    const text = "CAIU822565-9 // CAIU830527-1 // INKU252806-7\nCAIU8629352  // CAIU854490-7";
    const isos = parseSerialsFromPoText(text);
    expect(isos).toContain("CAIU8225659");
    expect(isos).toContain("INKU2528067");
    expect(isos).toContain("CAIU8629352");
  });

  it("extrae seriales separados solo por salto de línea (sin //)", () => {
    const text = "JXLU402859-9\nZCSU402720-5\nZCSU401690-0\nZCSU401278-2";
    expect(parseSerialsFromPoText(text)).toEqual(["JXLU4028599", "ZCSU4027205", "ZCSU4016900", "ZCSU4012782"]);
  });

  it("un move con tres lotes replica OC y precio a los tres", () => {
    const ref = purchaseRefFromOrder({ poId: 7861, poName: "OC-0010007645", unitPrice: 1500, vendorName: "ECONTAINERS GLOBAL LLC" });
    const assigned = assignRefsBySharedMove(
      [
        { lotId: 21537, moveId: 100635 },
        { lotId: 21538, moveId: 100635 },
        { lotId: 21539, moveId: 100635 },
      ],
      new Map([[100635, ref]]),
    );
    expect([...assigned.keys()].sort()).toEqual([21537, 21538, 21539]);
    expect(assigned.get(21538)).toMatchObject({ odooPoName: "OC-0010007645", odooUnitPrice: 1500 });
  });

  it("el texto con saltos de línea enlaza serial → lote sin pisar una OC ya resuelta", () => {
    const ref = purchaseRefFromOrder({ poId: 7861, poName: "OC-0010007645", unitPrice: 1500 });
    const byIso = new Map([
      ["ZCSU4012782", 21538],
      ["ZCSU4027205", 21537],
    ]);
    const already = new Map([[21537, purchaseRefFromOrder({ poName: "OC-OTRA", unitPrice: 1 })]]);
    const out = applySerialTextRefs(
      [{ name: "JXLU402859-9\nZCSU402720-5\nZCSU401690-0\nZCSU401278-2", orderId: 7861 }],
      byIso,
      new Map([[7861, ref]]),
      already,
    );
    expect(out.get(21538)?.odooPoName).toBe("OC-0010007645");
    expect(out.get(21537)?.odooPoName).toBe("OC-OTRA");
  });

  it("guarda precio unitario solo si es positivo", () => {
    expect(purchaseRefFromOrder({ unitPrice: 1325 }).odooUnitPrice).toBe(1325);
    expect(purchaseRefFromOrder({ unitPrice: 0 }).odooUnitPrice).toBeNull();
  });

  it("acepta grados de evaluación admin", () => {
    expect(parseCondition("Bueno")).toBe("bueno");
    expect(parseCondition("excelente")).toBeNull();
  });
});

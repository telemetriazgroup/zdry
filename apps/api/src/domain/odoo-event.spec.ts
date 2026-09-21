import { applyOdooEvent, mapLotPayloadToOwned, normalizeIncomingEvent, webhookSecretOk } from "./odoo-event";

describe("normalizeIncomingEvent", () => {
  it("normaliza snake_case y origen por defecto odoo", () => {
    const ev = normalizeIncomingEvent({
      id: 12,
      model: "stock.lot",
      res_id: 17038,
      iso: "LATU901117-1",
      event: "lot_write",
      payload: { color: "ROJO" },
      write_date: "2026-09-19 16:00:00",
    });
    expect(ev?.origin).toBe("odoo");
    expect(ev?.resId).toBe(17038);
    expect(ev?.isoNormalized).toBe("LATU9011171");
    expect(ev?.odooEventId).toBe(12);
  });
});

describe("mapLotPayloadToOwned", () => {
  it("mapea claves técnicas de date_sotck_move", () => {
    expect(
      mapLotPayloadToOwned({
        color: "ROJO",
        tara: "3680",
        weight: "26590",
        building_year: "2024",
        nro_dua: "118-2026-10-1",
        procedence: "CHINA",
        maker: "CIMC",
        material: "ACERO",
      }),
    ).toEqual({
      color: "ROJO",
      tareKg: 3680,
      mgwKg: 26590,
      year: 2024,
      dua: "118-2026-10-1",
      originCountry: "CHINA",
      manufacturer: "CIMC",
      material: "ACERO",
    });
  });
});

describe("applyOdooEvent", () => {
  it("anti-eco: origin zdry no pisa ZDRY", () => {
    const r = applyOdooEvent({
      event: { event: "lot_write", origin: "zdry", payload: { color: "AZUL" } },
      localTouched: false,
      current: { color: "Rojo" },
    });
    expect(r.action).toBe("ignore");
    expect(r).toMatchObject({ reason: "anti-eco" });
  });

  it("lot_write sin localTouched aplica tara", () => {
    const r = applyOdooEvent({
      event: { event: "lot_write", payload: { tara: "3700" } },
      localTouched: false,
      current: { tareKg: 3600 },
    });
    expect(r).toMatchObject({ action: "apply", source: "odoo", updates: { tareKg: 3700 } });
  });

  it("lot_write con localTouched: Odoo pisa y deja rastro overwritten", () => {
    const r = applyOdooEvent({
      event: { event: "lot_write", payload: { color: "AZUL" } },
      localTouched: true,
      current: { color: "ROJO" },
    });
    expect(r.action).toBe("apply");
    if (r.action === "apply") {
      expect(r.updates).toEqual({ color: "AZUL" });
      expect(r.overwritten).toEqual([{ field: "color", localValue: "ROJO", odooValue: "AZUL" }]);
    }
  });

  it("lot_write con localTouched y mismo valor no es conflicto", () => {
    const r = applyOdooEvent({
      event: { event: "lot_write", payload: { color: "ROJO" } },
      localTouched: true,
      current: { color: "ROJO" },
    });
    expect(r).toMatchObject({ action: "apply", updates: { color: "ROJO" } });
  });

  it("picking_in_done pide refresh de ISOs", () => {
    const r = applyOdooEvent({
      event: { event: "picking_in_done", iso: "BMOU433548-9", payload: { isos: ["BMOU433548-9", "CAIU807254-0"] } },
    });
    expect(r.action).toBe("refresh");
    if (r.action === "refresh") expect(r.isos).toEqual(expect.arrayContaining(["BMOU433548-9", "CAIU807254-0"]));
  });

  it("mo_done pide refresh del lote fabricado", () => {
    const r = applyOdooEvent({
      event: { event: "mo_done", iso: "LATU901117-1", payload: { mo_name: "ZGROU/MO/00292", lot_ids: [17001] } },
    });
    expect(r.action).toBe("refresh");
    if (r.action === "refresh") expect(r.isos).toContain("LATU901117-1");
  });

  it("lot_note solo se registra en expediente", () => {
    const r = applyOdooEvent({
      event: { event: "lot_note", iso: "BMOU433548-9", payload: { body: "Ajuste inicial", note_id: 44 } },
    });
    expect(r).toMatchObject({ action: "record", reason: "nota de serie" });
  });

  it("sale_state e invoice_posted se registran (Q7 / J5)", () => {
    const r = applyOdooEvent({ event: { event: "sale_state", payload: { state: "sale" } } });
    expect(r.action).toBe("record");
    const inv = applyOdooEvent({ event: { event: "invoice_posted", payload: { move_type: "out_invoice" } } });
    expect(inv.action).toBe("record");
  });
});

describe("webhookSecretOk", () => {
  it("exige secreto configurado y match exacto", () => {
    expect(webhookSecretOk("abc", "")).toBe(false);
    expect(webhookSecretOk("abc", "abc")).toBe(true);
    expect(webhookSecretOk("no", "abc")).toBe(false);
  });
});

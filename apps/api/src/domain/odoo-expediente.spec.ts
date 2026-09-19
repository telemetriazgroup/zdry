import { backfillDocsFromCandidate, diffsFromLotWrite, fieldEvolution, noteFromEvent, snapshotFromEvent } from "./odoo-expediente";
import { normalizeIncomingEvent } from "./odoo-event";

describe("expediente", () => {
  it("lot_write solo diffea campos del payload", () => {
    const diffs = diffsFromLotWrite(
      { color: "ROJO", tareKg: 3860, material: "ACERO", dua: "118-1" },
      { tara: "3711" },
      { tareKg: 3711 },
      [],
    );
    expect(diffs).toEqual([{ field: "tareKg", before: "3860", after: "3711", applied: true }]);
  });

  it("diff de ficha marca conflicto no aplicado", () => {
    const diffs = diffsFromLotWrite({ color: "ROJO", tareKg: 3600 }, { color: "AZUL", tara: "3711" }, { tareKg: 3711 }, [
      { field: "color" },
    ]);
    expect(diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "color", before: "ROJO", after: "AZUL", applied: false }),
        expect.objectContaining({ field: "tareKg", before: "3600", after: "3711", applied: true }),
      ]),
    );
  });

  it("snapshot OC / IN / MO desde evento enriquecido", () => {
    const po = snapshotFromEvent(
      normalizeIncomingEvent({
        event: "po_confirm",
        model: "purchase.order",
        res_id: 9707,
        payload: { po_name: "OC-0010009472", partner: "ECONTAINERS", amount_total: 27825, currency: "USD", state: "purchase" },
      })!,
    );
    expect(po).toMatchObject({ kind: "purchase", name: "OC-0010009472", odooId: 9707 });
    const mo = snapshotFromEvent(
      normalizeIncomingEvent({
        event: "mo_done",
        model: "mrp.production",
        res_id: 292,
        iso: "LATU901117-1",
        payload: { mo_name: "ZGROU/MO/00292", product_finished: "CDND0081 XL-LR", source_product: "CDD40H0058" },
      })!,
    );
    expect(mo).toMatchObject({ kind: "mo", name: "ZGROU/MO/00292" });
    expect(mo?.summary).toMatch(/CDND0081/);
  });

  it("nota chatter sin cuerpo se descarta", () => {
    expect(noteFromEvent(normalizeIncomingEvent({ event: "lot_note", payload: { body: "  " } })!)).toBeNull();
    expect(noteFromEvent(normalizeIncomingEvent({ event: "lot_note", payload: { body: "Ajuste inicial", author: "Admin", note_id: 44 } })!)).toMatchObject({
      body: "Ajuste inicial",
      author: "Admin",
      odooMessageId: 44,
    });
  });

  it("backfill J1 no inventa documentos vacíos", () => {
    expect(backfillDocsFromCandidate({ isoNormalized: "X" })).toEqual([]);
    const docs = backfillDocsFromCandidate({
      isoNormalized: "BMOU4335489",
      odooPoId: 9707,
      odooPoName: "OC-0010009472",
      odooVendorName: "ECONTAINERS",
      odooBillName: "C 3303",
      odooPickingName: "ZGROU/IN/06302",
      odooIntakeKind: "purchase",
      odooUnitPrice: 1325,
    });
    expect(docs.map((d) => d.kind).sort()).toEqual(["bill", "picking_in", "purchase"]);
  });

  it("evolución agrupa un campo en orden cronológico", () => {
    const evo = fieldEvolution([
      { field: "tareKg", before: "3600", after: "3700", source: "zdry", event: "ficha_save", createdAt: "2026-09-19T20:00:00.000Z" },
      { field: "tareKg", before: "3700", after: "3860", source: "odoo", event: "lot_write", createdAt: "2026-09-19T21:00:00.000Z", applied: true },
    ]);
    expect(evo).toHaveLength(1);
    expect(evo[0].label).toBe("Tara (kg)");
    expect(evo[0].current).toBe("3860");
    expect(evo[0].steps.map((s) => s.value)).toEqual(["3600", "3700", "3860"]);
    expect(evo[0].steps.map((s) => s.source)).toEqual(["prev", "zdry", "odoo"]);
    const skipped = fieldEvolution([
      { field: "color", before: "blanco", after: "CREMA", source: "odoo", event: "lot_write", createdAt: "2026-09-19T21:00:00.000Z", applied: false },
    ]);
    expect(skipped[0].current).toBe("blanco");
  });
});

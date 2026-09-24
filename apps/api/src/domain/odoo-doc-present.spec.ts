import { toDispatchExpediente, type OdooDocView } from "./odoo-doc-present";

function view(partial: Partial<OdooDocView> & { kind: string; title: string }): OdooDocView {
  return {
    subtitle: "",
    pending: null,
    rows: [],
    pickings: [],
    lines: [],
    components: [],
    totals: [],
    overhead: null,
    isos: [],
    ...partial,
  };
}

describe("toDispatchExpediente", () => {
  it("deja la referencia de venta sin precio y omite la orden de compra", () => {
    const out = toDispatchExpediente({
      isoNormalized: "MSKU0734355",
      documents: [
        {
          current: { id: "po", kind: "purchase", name: "OC-0010010493" },
          view: view({
            kind: "purchase",
            title: "OC-0010010493",
            rows: [{ label: "Total", value: "USD 40,139" }],
            pickings: [{ name: "ZGROU/IN/07001", isos: ["OTRA"] }],
          }),
        },
        {
          current: { id: "so", kind: "sale", name: "10020263940" },
          view: view({
            kind: "sale",
            title: "10020263940",
            subtitle: "FLOWEN · USD 1,790",
            rows: [
              { label: "Cliente / destino", value: "FLOWEN S.A.C." },
              { label: "Estado", value: "sale" },
              { label: "Total", value: "USD 1,790" },
              { label: "Fecha", value: "2026-09-24" },
            ],
            lines: [{ label: "DRY 40", qty: "1", amount: "USD 1,790" }],
          }),
        },
        {
          current: { id: "out", kind: "picking_out", name: "ZGROU/OUT/08515" },
          view: view({
            kind: "picking_out",
            title: "ZGROU/OUT/08515",
            rows: [
              { label: "Fecha", value: "2026-09-24 11:32" },
              { label: "Desde", value: "Existencias" },
              { label: "Hacia", value: "Customers" },
              { label: "Cliente / destino", value: "FLOWEN S.A.C." },
            ],
          }),
        },
        {
          current: { id: "ro", kind: "repair", name: "ZGROU/RO/01560" },
          view: view({
            kind: "repair",
            title: "ZGROU/RO/01560",
            rows: [
              { label: "Estado", value: "done" },
              { label: "Fecha", value: "2026-09-24 16:23" },
            ],
          }),
        },
      ],
    });

    expect(out.sale.map((d) => d.title)).toEqual(["10020263940"]);
    expect(out.sale[0].rows.map((r) => r.label)).toEqual(["Cliente / destino", "Estado", "Fecha"]);
    expect(JSON.stringify(out)).not.toMatch(/40,139|1,790|OC-001/);
    expect(out.dispatch.map((d) => d.title)).toEqual(["ZGROU/OUT/08515"]);
    expect(out.repairs.map((d) => d.title)).toEqual(["ZGROU/RO/01560"]);
    expect(out.trace.map((t) => t.kind)).toEqual(["picking_out", "repair"]);
  });
});

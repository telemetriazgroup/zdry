import { parseTypeMerge, retargetTypeRows } from "./type-merge";

describe("parseTypeMerge", () => {
  it("normaliza el que queda y descarta el mismo código", () => {
    expect(parseTypeMerge({ keep: " 20gp ", absorb: ["20dc", "20GP", "20dc", ""] })).toEqual({
      keep: "20GP",
      absorb: ["20DC"],
    });
  });
});

describe("retargetTypeRows", () => {
  it("pasa el tipo absorbido y conserva la regla del que queda", () => {
    const rows = [
      { type: "20DC", cat: null, amount: 1000 },
      { type: "20GP", cat: null, amount: 2800 },
      { type: "40HC", cat: null, amount: 4200 },
    ];
    expect(retargetTypeRows(rows, "type", ["20DC"], "20GP", (r) => `${r.type}|${r.cat || ""}`)).toEqual([
      { type: "20GP", cat: null, amount: 2800 },
      { type: "40HC", cat: null, amount: 4200 },
    ]);
  });

  it("mueve la regla si el que queda no tenía una igual", () => {
    const rows = [{ type: "40DC", cat: "CW", supplier: null, origin: null, warehouse: null, marginPct: 9 }];
    expect(
      retargetTypeRows(rows, "type", ["40DC"], "40GP", (r) => `${r.type}|${r.cat}|${r.supplier}|${r.origin}|${r.warehouse}`),
    ).toEqual([{ type: "40GP", cat: "CW", supplier: null, origin: null, warehouse: null, marginPct: 9 }]);
  });
});

import { freshOdooLotIds, normalizeOdooWatch } from "./odoo-import-watch";

describe("odoo import watch", () => {
  it("por defecto es manual", () => {
    expect(normalizeOdooWatch(undefined)).toMatchObject({ mode: "manual", lastNew: 0, lastMessage: "" });
    expect(normalizeOdooWatch({ mode: "auto", lastNew: 3, lastMessage: "3 nuevos" }).mode).toBe("auto");
  });

  it("deja fuera los lotes que ya existen", () => {
    expect(freshOdooLotIds([10, 11, 11, 12, 0], [11, 12])).toEqual([10]);
  });
});

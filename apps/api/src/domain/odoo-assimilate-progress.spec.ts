import { idleAssimilateProgress, normalizeAssimilateProgress } from "./odoo-assimilate-progress";

describe("assimilate progress", () => {
  it("shape idle / running / done", () => {
    expect(idleAssimilateProgress()).toMatchObject({ status: "idle", current: 0, total: 0, iso: "" });
    expect(normalizeAssimilateProgress({ status: "running", step: "dossier", current: 2, total: 5, iso: "BMOU4349332", message: "OC" })).toEqual({
      status: "running",
      step: "dossier",
      current: 2,
      total: 5,
      iso: "BMOU4349332",
      message: "OC",
      updatedAt: "",
    });
    expect(normalizeAssimilateProgress({ status: "done", step: "listo", current: 5, total: 5 }).status).toBe("done");
    expect(normalizeAssimilateProgress(null).status).toBe("idle");
  });
});

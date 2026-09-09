import { slugEvalKey } from "./evaluation";

describe("evaluation keys", () => {
  it("normaliza etiquetas a clave estable", () => {
    expect(slugEvalKey("Piso interior", "x")).toBe("piso_interior");
    expect(slugEvalKey("Pésimo", "x")).toBe("pesimo");
  });
});

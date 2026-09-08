import { canApplyGateIn } from "./depot-costs";

describe("Gate-In", () => {
  it("solo se aplica una vez por unidad", () => {
    expect(canApplyGateIn([])).toBe(true);
    expect(canApplyGateIn(["lavado"])).toBe(true);
    expect(canApplyGateIn(["gate_in"])).toBe(false);
    expect(canApplyGateIn(["gate_in", "lavado"])).toBe(false);
  });
});

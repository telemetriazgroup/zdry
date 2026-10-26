import { clientCondition, evaluationAverage, promotedCondition } from "./condition-offer";

describe("clientCondition", () => {
  it("agrupa todo lo que no es nuevo como segundo uso", () => {
    expect(clientCondition("1TRIP")).toEqual({ code: "nuevo", label: "Nuevo & 1 trip" });
    expect(clientCondition("CW").code).toBe("segundo");
    expect(clientCondition("WWT").label).toBe("Segundo uso");
    expect(clientCondition("ASIS").label).toBe("Segundo uso");
  });
});

describe("promotedCondition", () => {
  it("As Is con promedio 2 pasa a WWT y con 4 a CW", () => {
    expect(evaluationAverage(["malo", "regular"])).toBe(1.5);
    expect(promotedCondition("ASIS", 1.5)).toBe("ASIS");
    expect(evaluationAverage(["regular", "regular"])).toBe(2);
    expect(promotedCondition("ASIS", 2)).toBe("WWT");
    expect(evaluationAverage(["bueno", "excelente"])).toBe(4.5);
    expect(promotedCondition("ASIS", 4)).toBe("CW");
    expect(promotedCondition("WWT", 4)).toBe("CW");
    expect(promotedCondition("WWT", 2)).toBe("WWT");
    expect(promotedCondition("CW", 1)).toBe("CW");
    expect(promotedCondition("1TRIP", 5)).toBe("1TRIP");
  });

  it("promedia solo los conceptos evaluados", () => {
    expect(evaluationAverage(["excelente", "malo"])).toBe(3);
    expect(evaluationAverage([])).toBeNull();
    expect(promotedCondition("ASIS", null)).toBe("ASIS");
  });
});

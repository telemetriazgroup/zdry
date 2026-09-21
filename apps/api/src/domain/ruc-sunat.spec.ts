import {
  RUC_LOOKUP_LOCK_MS,
  RUC_LOOKUP_MAX,
  mapSunatRuc,
  missingAccountFields,
  missingQuoteFields,
  nextRucLookupState,
  normalizeRuc,
  rucLookupGate,
} from "./ruc-sunat";

describe("ruc-sunat Q1", () => {
  it("solo acepta RUC de 11 dígitos", () => {
    expect(normalizeRuc("20.421.360.121")).toBe("20421360121");
    expect(normalizeRuc("12345678")).toBeNull();
    expect(normalizeRuc("")).toBeNull();
  });

  it("permite 5 consultas y a la 6.ª bloquea 3 horas", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    expect(rucLookupGate({ attempts: 0, lockedUntil: null }, now).remaining).toBe(5);
    expect(rucLookupGate({ attempts: 4, lockedUntil: null }, now).ok).toBe(true);
    const fifth = nextRucLookupState({ attempts: 4, lockedUntil: null }, now);
    expect(fifth.attempts).toBe(5);
    expect(fifth.lockedUntil?.getTime()).toBe(now.getTime() + RUC_LOOKUP_LOCK_MS);
    const blocked = rucLookupGate(fifth, now);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/3 horas|min/);
  });

  it("tras el candado se puede volver a consultar", () => {
    const now = new Date("2026-09-21T16:00:00Z");
    const lockedUntil = new Date("2026-09-21T15:00:00Z");
    const gate = rucLookupGate({ attempts: 5, lockedUntil }, now);
    expect(gate.ok).toBe(true);
    expect(gate.remaining).toBe(RUC_LOOKUP_MAX);
  });

  it("mapea respuesta apiperu y eym", () => {
    const a = mapSunatRuc({ vat: "20413160121", name: "A & D INVERSIONES SAC", street: "CAL. NICOLAS" }, "20413160121");
    expect(a?.companyName).toBe("A & D INVERSIONES SAC");
    const b = mapSunatRuc({ RazonSocial: "IMEXCAL S.R.L.", Direccion: "LIMA", Distrito: "ATE" }, "20603301234");
    expect(b?.district).toBe("ATE");
    expect(mapSunatRuc({ vat: "20413160121" }, "20413160121")).toBeNull();
  });

  it("cotizar exige RUC validado; la cuenta no", () => {
    const contact = { contactName: "Ada", email: "a@b.pe", phone: "999" };
    expect(missingAccountFields(contact)).toEqual([]);
    expect(missingQuoteFields(contact).some((m) => m.includes("RUC"))).toBe(true);
    expect(
      missingQuoteFields({
        ...contact,
        rucDni: "20413160121",
        companyName: "A & D",
        rucValidatedAt: new Date(),
      }),
    ).toEqual([]);
  });
});

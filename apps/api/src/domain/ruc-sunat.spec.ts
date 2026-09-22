import {
  RUC_LOOKUP_LOCK_MS,
  RUC_LOOKUP_MAX,
  isValidPeruRuc,
  mapSunatRuc,
  missingAccountFields,
  missingQuoteFields,
  nextRucLookupState,
  normalizeRuc,
  presentSunat,
  rucLookupGate,
  sunatAddressLine,
  sunatNeedsRefresh,
} from "./ruc-sunat";

describe("ruc-sunat Q1", () => {
  it("solo acepta RUC de 11 dígitos", () => {
    expect(normalizeRuc("20.421.360.121")).toBe("20421360121");
    expect(normalizeRuc("12345678")).toBeNull();
    expect(normalizeRuc("")).toBeNull();
  });

  it("valida dígito verificador SUNAT", () => {
    expect(isValidPeruRuc("20100070970")).toBe(true);
    expect(isValidPeruRuc("20100070971")).toBe(false);
    expect(isValidPeruRuc("73144300")).toBe(false);
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

  it("jala domicilio, estado y condición de EYM/Odoo", () => {
    const eym = mapSunatRuc(
      {
        ok: true,
        source: "eym",
        vat: "20521180774",
        name: "ZGROUP S.A.C.",
        street: "CAL. ORDONER VARGAS NRO 142",
        district: "LOS OLIVOS",
        province: "LIMA",
        department: "LIMA",
        taxpayer_state: "ACTIVO",
        taxpayer_condition: "HABIDO",
      },
      "20521180774",
    );
    expect(eym).toMatchObject({
      companyName: "ZGROUP S.A.C.",
      street: "CAL. ORDONER VARGAS NRO 142",
      district: "LOS OLIVOS",
      department: "LIMA",
      sunatState: "ACTIVO",
      sunatCondition: "HABIDO",
      source: "eym",
    });
    expect(sunatAddressLine(eym!)).toContain("LOS OLIVOS");
    expect(sunatNeedsRefresh({ rucDni: "20521180774", street: "", sunatState: "SIN_ODOO" })).toBe(true);
    expect(sunatNeedsRefresh({ rucDni: "20521180774", street: "CAL. X", sunatState: "ACTIVO" })).toBe(false);
    expect(presentSunat({ ...eym!, rucDni: eym!.ruc }).address).toMatch(/ORDONER/);
  });

  it("desanida data/result de otras APIs SUNAT", () => {
    const nested = mapSunatRuc(
      {
        data: {
          ruc: "20100070970",
          razonSocial: "SUPERMERCADOS PERUANOS",
          direccion: "CAL. MORELLI 181",
          distrito: "SAN BORJA",
          estado: "ACTIVO",
          condicion: "HABIDO",
        },
      },
      "20100070970",
    );
    expect(nested?.street).toBe("CAL. MORELLI 181");
    expect(nested?.sunatState).toBe("ACTIVO");
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

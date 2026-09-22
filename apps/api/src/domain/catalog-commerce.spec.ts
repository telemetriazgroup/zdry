import { normalizeCatalogCommerce } from "./catalog-commerce";
import { clampShareHours, normalizeShareDraft, shareExpiresAt, shareIsLive } from "./catalog-share";

describe("catalog commerce mode", () => {
  it("por defecto es modo WhatsApp: sin cotización ni altas públicas", () => {
    expect(normalizeCatalogCommerce(undefined)).toMatchObject({
      mode: "whatsapp",
      quotesEnabled: false,
      accountsEnabled: false,
    });
  });

  it("modo full enciende cotización y cuentas", () => {
    expect(normalizeCatalogCommerce({ mode: "full", whatsapp: "+51 999 111 222" })).toMatchObject({
      mode: "full",
      quotesEnabled: true,
      accountsEnabled: true,
      whatsapp: "51999111222",
    });
  });
});

describe("catalog share", () => {
  it("acota vigencia entre 48 y 120 horas", () => {
    expect(clampShareHours(24)).toBe(48);
    expect(clampShareHours(200)).toBe(120);
    expect(clampShareHours(72)).toBe(72);
  });

  it("exige cliente y WhatsApp del comercial", () => {
    expect(() => normalizeShareDraft({ clientName: "A", vendorWhatsapp: "999111222" })).toThrow(/nombre/);
    expect(() => normalizeShareDraft({ clientName: "Nestlé", vendorWhatsapp: "123" })).toThrow(/WhatsApp/);
    expect(normalizeShareDraft({ clientName: "Nestlé Perú", vendorWhatsapp: "999 111 222", hours: 96 })).toMatchObject({
      clientName: "Nestlé Perú",
      vendorWhatsapp: "999111222",
      hours: 96,
    });
  });

  it("vence al cumplir las horas", () => {
    const start = new Date("2026-09-22T15:00:00.000Z");
    const exp = shareExpiresAt(start, 48);
    expect(shareIsLive(exp, new Date("2026-09-24T14:59:00.000Z"))).toBe(true);
    expect(shareIsLive(exp, new Date("2026-09-24T15:01:00.000Z"))).toBe(false);
  });
});

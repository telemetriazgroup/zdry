import { normalizeCatalogCommerce } from "./catalog-commerce";
import { clampShareHours, deviceFromAgent, grantMatchesSession, newShareAccessCode, normalizeShareDraft, planShareRenew, readShareGrant, shareCodeMatches, shareExpiresAt, shareIsLive, shareStatus, signShareGrant, summarizeShareEvents } from "./catalog-share";

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
  it("acota vigencia entre 24 y 240 horas", () => {
    expect(clampShareHours(12)).toBe(24);
    expect(clampShareHours(24)).toBe(24);
    expect(clampShareHours(300)).toBe(240);
    expect(clampShareHours(72)).toBe(72);
  });

  it("exige RUC SUNAT, contacto y WhatsApp del comercial", () => {
    expect(() => normalizeShareDraft({ clientName: "Ana", vendorWhatsapp: "999111222" })).toThrow(/RUC/);
    expect(() => normalizeShareDraft({
      ruc: "20100070970",
      clientCompany: "Empresa Demo",
      contactName: "Ana",
      clientEmail: "ana@demo.pe",
      clientPhone: "999111222",
      vendorWhatsapp: "123",
    })).toThrow(/WhatsApp/);
    expect(normalizeShareDraft({
      ruc: "20100070970",
      clientCompany: "Empresa Demo SAC",
      contactName: "Ana Contacto",
      clientEmail: "ana@demo.pe",
      clientPhone: "999 111 222",
      vendorWhatsapp: "999 111 333",
      hours: 24,
    })).toMatchObject({
      ruc: "20100070970",
      contactName: "Ana Contacto",
      clientEmail: "ana@demo.pe",
      vendorWhatsapp: "999111333",
      hours: 24,
    });
  });

  it("la clave del enlace tiene 6 dígitos y no viaja en la cookie", () => {
    const code = newShareAccessCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(shareCodeMatches("048215", "048215")).toBe(true);
    expect(shareCodeMatches("048215", "048216")).toBe(false);
    expect(shareCodeMatches("048215", "48215")).toBe(false);
    const grant = signShareGrant("abc123", "sess1");
    expect(grant.includes("048215")).toBe(false);
    expect(readShareGrant(grant)).toEqual({ token: "abc123", sessionId: "sess1" });
    expect(readShareGrant("abc123.no")).toBeNull();
    const other = signShareGrant("abc123", "sess2");
    expect(grantMatchesSession(grant, "sess1")).toBe("ok");
    expect(grantMatchesSession(other, "sess1")).toBe("moved");
    expect(grantMatchesSession(grant, "")).toBe("deny");
  });

  it("resume visitas, filtros, búsquedas e imágenes repetidas", () => {
    expect(deviceFromAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("móvil");
    const summary = summarizeShareEvents([
      { kind: "open", createdAt: "2026-09-23T12:00:00.000Z", ip: "1.1.1.1", device: "móvil" },
      { kind: "search", detail: { q: "40HC" }, createdAt: "2026-09-23T12:01:00.000Z" },
      { kind: "search", detail: { q: "40HC" }, createdAt: "2026-09-23T12:02:00.000Z" },
      { kind: "view_image", iso: "ZCSU1", detail: { slot: 0 }, createdAt: "2026-09-23T12:03:00.000Z" },
      { kind: "view_image", iso: "ZCSU1", detail: { slot: 0 }, createdAt: "2026-09-23T12:04:00.000Z" },
    ]);
    expect(summary.opens).toHaveLength(1);
    expect(summary.searches).toEqual([{ q: "40HC", count: 2 }]);
    expect(summary.images).toEqual([{ iso: "ZCSU1", slot: "0", count: 2 }]);
    expect(summary.units[0]).toMatchObject({ iso: "ZCSU1", views: 0, images: 2, returns: 0 });
  });

  it("vence al cumplir las horas", () => {
    const start = new Date("2026-09-22T15:00:00.000Z");
    const exp = shareExpiresAt(start, 48);
    expect(shareIsLive(exp, new Date("2026-09-24T14:59:00.000Z"))).toBe(true);
    expect(shareIsLive(exp, new Date("2026-09-24T15:01:00.000Z"))).toBe(false);
  });

  it("extiende un enlace vigente y reactiva uno vencido desde ahora", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    const live = planShareRenew({ expiresAt: new Date("2026-10-11T12:00:00.000Z") }, 24, now);
    expect(live.mode).toBe("extend");
    expect(live.expiresAt.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    const dead = planShareRenew({ expiresAt: new Date("2026-10-01T12:00:00.000Z") }, 48, now);
    expect(dead.mode).toBe("reactivate");
    expect(dead.expiresAt.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(shareStatus({ archivedAt: now, expiresAt: now })).toBe("archivado");
    expect(() => planShareRenew({ archivedAt: now, expiresAt: now }, 24, now)).toThrow(/archivado/);
  });
});

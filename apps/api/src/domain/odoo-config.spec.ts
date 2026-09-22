import { envOdooConfig, normalizeOdooConfig, odooCredentialsReady, odooQuoteSyncReady } from "./odoo-config";

describe("odoo-config", () => {
  const creds = {
    enabled: false,
    url: "https://odoo.example",
    db: "zgroup",
    user: "bot@zgroup.com.pe",
    apiKey: "secret",
  };

  it("trata URL+clave como listo para emitir cotización aunque enabled=false", () => {
    expect(odooCredentialsReady(creds)).toBe(true);
    expect(odooQuoteSyncReady(creds)).toBe(true);
    expect(odooQuoteSyncReady({ ...creds, apiKey: "" })).toBe(false);
  });

  it("hereda credenciales del entorno si no hay fila guardada", () => {
    const cfg = normalizeOdooConfig(null, creds);
    expect(cfg.url).toBe(creds.url);
    expect(cfg.enabled).toBe(false);
    expect(odooQuoteSyncReady(cfg)).toBe(true);
  });

  it("envOdooConfig lee ODOO_*", () => {
    const cfg = envOdooConfig();
    expect(cfg).toEqual(
      expect.objectContaining({
        enabled: expect.any(Boolean),
        url: expect.any(String),
        db: expect.any(String),
      }),
    );
  });
});

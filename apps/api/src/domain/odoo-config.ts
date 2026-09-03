export const ODOO_CONFIG_KEY = "odoo_config";

export type OdooConfig = {
  enabled: boolean;
  url: string;
  db: string;
  user: string;
  apiKey: string;
};

export function envOdooConfig(): OdooConfig {
  return {
    enabled: process.env.ODOO_ENABLED === "true",
    url: process.env.ODOO_URL || "",
    db: process.env.ODOO_DB || "",
    user: process.env.ODOO_USER || "",
    apiKey: process.env.ODOO_API_KEY || "",
  };
}

export function normalizeOdooConfig(raw: unknown, fallback: OdooConfig = envOdooConfig()): OdooConfig {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const apiKey = typeof src.apiKey === "string" ? src.apiKey.trim() : "";
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : fallback.enabled,
    url: typeof src.url === "string" ? src.url.trim() : fallback.url,
    db: typeof src.db === "string" ? src.db.trim() : fallback.db,
    user: typeof src.user === "string" ? src.user.trim() : fallback.user,
    apiKey: apiKey || fallback.apiKey,
  };
}

export function publicOdooConfig(cfg: OdooConfig) {
  return {
    enabled: cfg.enabled,
    url: cfg.url,
    db: cfg.db,
    user: cfg.user,
    apiKeySet: Boolean(cfg.apiKey),
  };
}

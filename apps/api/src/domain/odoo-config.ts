export const ODOO_CONFIG_KEY = "odoo_config";
export const ODOO_MODES_KEY = "odoo_modes";

export type OdooModeName = "staging" | "production";

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

export function odooCredentialsReady(cfg: OdooConfig): boolean {
  return Boolean(cfg.url && cfg.db && cfg.user && cfg.apiKey);
}

/** Emisión de cotización: si hay URL y clave, opera. El flag enabled=false de S0 no debe dejar el job en cola. */
export function odooQuoteSyncReady(cfg: OdooConfig): boolean {
  return odooCredentialsReady(cfg);
}

export function publicOdooConfig(cfg: OdooConfig) {
  return {
    enabled: cfg.enabled || odooCredentialsReady(cfg),
    url: cfg.url,
    db: cfg.db,
    user: cfg.user,
    apiKeySet: Boolean(cfg.apiKey),
  };
}

export type OdooModeStore = {
  active: OdooModeName | null;
  staging: OdooConfig | null;
  production: OdooConfig | null;
};

const EMPTY_ODOO: OdooConfig = { enabled: false, url: "", db: "", user: "", apiKey: "" };

export function looksLikeStaging(cfg: { url?: string; db?: string }): boolean {
  return /staging|dev\.odoo/i.test(`${cfg.url || ""} ${cfg.db || ""}`);
}

function slotFrom(raw: unknown): OdooConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const cfg = normalizeOdooConfig(raw, EMPTY_ODOO);
  if (!cfg.url && !cfg.db && !cfg.user && !cfg.apiKey) return null;
  return cfg;
}

/** Si todavía no hay dos modos guardados, el conector vivo se toma como el modo que su URL indica. */
export function normalizeOdooModes(raw: unknown, live: OdooConfig): OdooModeStore {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!src) return inferOdooModes(live);
  const active = src.active === "staging" || src.active === "production" ? src.active : null;
  return {
    active,
    staging: slotFrom(src.staging),
    production: slotFrom(src.production),
  };
}

export function inferOdooModes(live: OdooConfig): OdooModeStore {
  if (!live.url && !live.db) return { active: null, staging: null, production: null };
  if (looksLikeStaging(live)) return { active: "staging", staging: live, production: null };
  return { active: "production", staging: null, production: live };
}

export function publicOdooMode(cfg: OdooConfig | null) {
  if (!cfg) return { saved: false, enabled: false, url: "", db: "", user: "", apiKeySet: false };
  return { saved: true, ...publicOdooConfig(cfg) };
}

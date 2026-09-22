export const CATALOG_COMMERCE_KEY = "catalog_commerce";

export const CATALOG_COMMERCE_MODES = ["whatsapp", "full"] as const;
export type CatalogCommerceMode = (typeof CATALOG_COMMERCE_MODES)[number];

export type CatalogCommerce = {
  mode: CatalogCommerceMode;
  quotesEnabled: boolean;
  accountsEnabled: boolean;
  whatsapp: string;
  coordinatorName: string;
};

export const DEFAULT_CATALOG_COMMERCE: CatalogCommerce = {
  mode: "whatsapp",
  quotesEnabled: false,
  accountsEnabled: false,
  whatsapp: "",
  coordinatorName: "",
};

export function whatsappDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeCatalogCommerce(raw: unknown): CatalogCommerce {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const explicit = src.mode === "full" || src.mode === "whatsapp" ? src.mode : null;
  const mode: CatalogCommerceMode = explicit || (src.quotesEnabled === true && src.accountsEnabled === true ? "full" : "whatsapp");
  const full = mode === "full";
  return {
    mode,
    quotesEnabled: full,
    accountsEnabled: full,
    whatsapp: whatsappDigits(src.whatsapp),
    coordinatorName: typeof src.coordinatorName === "string" ? src.coordinatorName.trim().slice(0, 80) : "",
  };
}

export function publicQuotesBlockedMessage(): string {
  return "Las cotizaciones en línea están desactivadas. Coordina precio y pedido por WhatsApp.";
}

export function publicAccountsBlockedMessage(): string {
  return "La creación de cuentas está desactivada. Coordina tu pedido por WhatsApp.";
}

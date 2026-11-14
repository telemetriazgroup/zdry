export const ODOO_CUSTOM_PRODUCTS_KEY = "odoo_custom_products";

export type OdooCustomCount = {
  phrase: string;
  products: number;
  series: number;
  at?: string | null;
};

export type OdooCustomProductsState = {
  phrases: string[];
  last: OdooCustomCount[];
};

export function foldProductName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Texto que Odoo busca en el nombre. Las vocales aceptan tilde. */
export function odooNamePattern(phrase: string) {
  return foldProductName(phrase).replace(/[%_\\]/g, "").replace(/[aeiou]/g, "_");
}

export function phraseHitsName(phrase: string, name: string) {
  const needle = foldProductName(phrase);
  if (needle.length < 3) return false;
  return foldProductName(name).includes(needle);
}

/** «[MDND0004] MODULO…» busca el código y el nombre por separado. */
export function customSearchTerms(phrase: string) {
  const clean = String(phrase || "").replace(/\s+/g, " ").trim();
  const bracket = clean.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!bracket) return { code: "", name: clean };
  return { code: bracket[1].trim(), name: (bracket[2] || "").trim() };
}

export function phraseHitsProduct(phrase: string, name: string, code = "") {
  const term = customSearchTerms(phrase);
  if (term.code && foldProductName(code) === foldProductName(term.code)) return true;
  const needle = term.name || phrase;
  if (phraseHitsName(needle, name)) return true;
  const label = `${code ? `[${code}] ` : ""}${name}`.trim();
  return phraseHitsName(phrase, label);
}

export function normalizeOdooCustomProducts(raw: unknown): OdooCustomProductsState {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const incoming = Array.isArray(src.phrases) ? src.phrases : Array.isArray(raw) ? raw : [];
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const item of incoming) {
    const phrase = String(item || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const key = foldProductName(phrase);
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
    if (phrases.length >= 30) break;
  }
  const lastRaw = Array.isArray(src.last) ? src.last : [];
  const last: OdooCustomCount[] = [];
  for (const row of lastRaw) {
    if (!row || typeof row !== "object") continue;
    const phrase = String((row as { phrase?: string }).phrase || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!phrases.some((item) => foldProductName(item) === foldProductName(phrase))) continue;
    const products = Number((row as { products?: number }).products);
    const series = Number((row as { series?: number }).series);
    last.push({
      phrase,
      products: Number.isFinite(products) && products > 0 ? Math.round(products) : 0,
      series: Number.isFinite(series) && series > 0 ? Math.round(series) : 0,
      at: typeof (row as { at?: string }).at === "string" ? (row as { at: string }).at : null,
    });
  }
  return { phrases, last };
}

export function countCustomProducts(
  products: { id: number; name: string; code?: string }[],
  lots: { productId: number; lotId: number }[],
  phrases: string[],
): OdooCustomCount[] {
  return phrases.map((phrase) => {
    const productIds = new Set(products.filter((item) => phraseHitsProduct(phrase, item.name, item.code || "")).map((item) => item.id));
    const series = new Set<number>();
    for (const lot of lots) {
      if (lot.lotId && productIds.has(lot.productId)) series.add(lot.lotId);
    }
    return { phrase, products: productIds.size, series: series.size };
  });
}

import { parseIso6346 } from "./iso6346";

export function normalizeOdooSerial(raw: string) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .trim();
}

export function inspectOdooIso(raw: string) {
  const isoNormalized = normalizeOdooSerial(raw);
  const check = parseIso6346(isoNormalized || raw);
  const formatOk = !!check.valid;
  const iso6346Ok = formatOk && !!check.checkOk;
  return {
    serialRaw: String(raw || "").trim(),
    isoNormalized: check.code || isoNormalized,
    iso6346Ok,
    isoException: !iso6346Ok,
    check,
  };
}

export function inferTypeFromProduct(name: string, code: string, fallback = "40HC") {
  const hay = `${code} ${name}`.toUpperCase();
  if (hay.includes("45") && (hay.includes("HC") || hay.includes("HIGH"))) return "45HC";
  if (hay.includes("40") && (hay.includes("HC") || hay.includes("HIGH"))) return "40HC";
  if (hay.includes("40")) return "40GP";
  if (hay.includes("20") && (hay.includes("OT") || hay.includes("OPEN"))) return "20OT";
  if (hay.includes("20")) return "20GP";
  return fallback;
}

export function inferCatFromProduct(name: string, fallback = "ASIS") {
  const hay = name.toUpperCase();
  if (hay.includes("1-TRIP") || hay.includes("1 TRIP") || hay.includes("NUEVO") || hay.includes("NEW")) return "1TRIP";
  if (hay.includes("CARGO WORTHY") || hay.includes(" CW")) return "CW";
  if (hay.includes("WWT") || hay.includes("WIND")) return "WWT";
  return fallback;
}

export function titleFromLocation(completeName: string) {
  const parts = String(completeName || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || completeName || "Almacén Odoo";
}

export function guessColor(raw: string | null | undefined) {
  const t = String(raw || "").trim();
  if (!t) return "";
  const map: Record<string, string> = {
    AZUL: "Azul",
    BLUE: "Azul",
    BLANCO: "Blanco",
    WHITE: "Blanco",
    GRIS: "Gris",
    GRAY: "Gris",
    GREY: "Gris",
    VERDE: "Verde",
    GREEN: "Verde",
    ROJO: "Rojo",
    RED: "Rojo",
    AMARILLO: "Amarillo",
    YELLOW: "Amarillo",
    NARANJA: "Naranja",
    ORANGE: "Naranja",
    NEGRO: "Negro",
    BLACK: "Negro",
    CREMA: "Beige",
    CREAM: "Beige",
    BEIGE: "Beige",
    PLOMO: "Gris",
    PLATA: "Gris",
    SILVER: "Gris",
    MARRON: "Marrón",
    BROWN: "Marrón",
    CORTEN: "Corten (óxido natural)",
  };
  return map[t.toUpperCase()] || t;
}

function fold(s: string) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LABEL_HINTS = [
  "color",
  "tara",
  "peso",
  "dua",
  "procedencia",
  "material",
  "fabricante",
  "fabricacion",
  "zgroup",
  "codigo zgroup",
];

export function pickAllFieldsByLabel(
  fields: Record<string, { string?: string }>,
  needles: string[],
): string[] {
  const wanted = needles.map(fold).filter(Boolean);
  if (!wanted.length) return [];
  const score = (key: string) => {
    if (key.startsWith("x_studio")) return 0;
    if (key.startsWith("x_")) return 1;
    return 2;
  };
  const exact: string[] = [];
  const partial: string[] = [];
  for (const [key, meta] of Object.entries(fields || {})) {
    if (/^enable_/i.test(key)) continue;
    const label = fold(meta?.string || "");
    const tech = fold(key);
    if (wanted.includes(label) || wanted.includes(tech)) {
      exact.push(key);
      continue;
    }
    if (wanted.some((n) => label === n || label.startsWith(`${n} `) || label.endsWith(` ${n}`) || tech === n || tech.endsWith(` ${n}`) || tech.includes(`_${n}_`) || tech.endsWith(` ${n}`) || tech.endsWith(n))) {
      exact.push(key);
      continue;
    }
    if (wanted.some((n) => n.length >= 4 && (label.includes(n) || tech.includes(n)))) {
      partial.push(key);
    }
  }
  const uniq = [...new Set([...exact, ...partial])];
  return uniq.sort((a, b) => score(a) - score(b));
}

export function pickFieldByLabel(
  fields: Record<string, { string?: string }>,
  needles: string[],
): string | null {
  return pickAllFieldsByLabel(fields, needles)[0] || null;
}

export type OdooFieldMeta = { string?: string; type?: string; selection?: [string, string][] };

export function mergeFieldCatalog(
  fieldsGet: Record<string, OdooFieldMeta>,
  modelFields: { name?: string; field_description?: string; ttype?: string }[],
) {
  const out: Record<string, OdooFieldMeta> = { ...fieldsGet };
  for (const f of modelFields || []) {
    const name = String(f?.name || "").trim();
    if (!name) continue;
    const label = f.field_description || out[name]?.string;
    out[name] = { string: label, type: f.ttype || out[name]?.type, selection: out[name]?.selection };
  }
  return out;
}

export const ODOO_OWNED_FIELDS = [
  "color",
  "tareKg",
  "mgwKg",
  "year",
  "manufacturer",
  "dua",
  "originCountry",
  "material",
] as const;

export type OdooOwnedField = (typeof ODOO_OWNED_FIELDS)[number];

export const ODOO_OWNED_NEEDLES: Record<OdooOwnedField, string[]> = {
  color: ["color"],
  tareKg: ["tara"],
  mgwKg: ["peso kg", "peso", "weight kg", "weight"],
  year: ["ano de fabricacion", "building year", "building_year", "year"],
  manufacturer: ["fabricante", "manufacturer", "maker"],
  dua: ["n dua", "no dua", "nro dua", "dua"],
  originCountry: ["procedencia", "procedence"],
  material: ["tipo material", "material"],
};

export const ODOO_OWNED_LABELS: Record<OdooOwnedField, string> = {
  color: "Color",
  tareKg: "Tara (kg)",
  mgwKg: "Peso (kg)",
  year: "Año de fabricación",
  manufacturer: "Fabricante",
  dua: "Nº DUA",
  originCountry: "Procedencia",
  material: "Tipo material",
};

export function isOdooOwnedField(key: string): key is OdooOwnedField {
  return (ODOO_OWNED_FIELDS as readonly string[]).includes(key);
}

export function lotReadFieldNames(fields: Record<string, { string?: string }>) {
  const keys = new Set(["id", "name", "product_id", "write_date", "ref"]);
  for (const [k, meta] of Object.entries(fields || {})) {
    if (k.startsWith("x_")) keys.add(k);
    const label = fold(meta?.string || "");
    const tech = fold(k);
    if (LABEL_HINTS.some((h) => label.includes(h) || tech.includes(h))) keys.add(k);
  }
  for (const key of ODOO_OWNED_FIELDS) {
    for (const hit of pickAllFieldsByLabel(fields, ODOO_OWNED_NEEDLES[key])) keys.add(hit);
  }
  for (const hit of pickAllFieldsByLabel(fields, ["codigo zgroup", "codigo"])) keys.add(hit);
  return [...keys];
}

export type OdooLotAttrs = {
  serialRaw: string;
  color: string | null;
  tareKg: number | null;
  mgwKg: number | null;
  year: number | null;
  manufacturer: string | null;
  dua: string | null;
  originCountry: string | null;
  material: string | null;
  zgroupCode: string | null;
};

function scalar(v: unknown): string | null {
  if (v == null || v === false || v === true) return null;
  if (Array.isArray(v)) {
    const name = v[1] != null ? String(v[1]).trim() : "";
    return name || null;
  }
  const t = String(v).trim();
  return t && t !== "false" ? t : null;
}

function positiveInt(v: unknown): number | null {
  const raw = Array.isArray(v) ? v[0] : v;
  const n = Number(String(raw ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function yearOf(v: unknown): number | null {
  const n = positiveInt(v);
  if (!n) return null;
  if (n >= 1970 && n <= 2100) return n;
  return null;
}

export function readLotAttrs(lot: Record<string, unknown> | undefined, fields: Record<string, { string?: string }>): OdooLotAttrs {
  const get = (needles: string[]) => {
    if (!lot) return null;
    const keys = pickAllFieldsByLabel(fields, needles);
    for (const key of keys) {
      if (/^enable_/i.test(key)) continue;
      const v = lot[key];
      if (v != null && v !== false && v !== true && v !== "") return v;
    }
    return keys[0] ? lot[keys[0]] : null;
  };
  return {
    serialRaw: scalar(lot?.name) || "",
    color: scalar(get(["color"])),
    tareKg: positiveInt(get(["tara"])),
    mgwKg: positiveInt(get(["peso kg", "peso"])),
    year: yearOf(get(["ano de fabricacion", "year"])),
    manufacturer: scalar(get(["fabricante", "manufacturer"])),
    dua: scalar(get(["n dua", "no dua", "nro dua", "dua"])),
    originCountry: scalar(get(["procedencia"])),
    material: scalar(get(["tipo material", "material"])),
    zgroupCode: scalar(get(["codigo zgroup"])),
  };
}

export function coerceOdooWriteValue(
  type: string | undefined,
  value: unknown,
  selection?: [string, string][],
): unknown {
  if (value === null || value === undefined || value === "") return false;
  const t = String(type || "").toLowerCase();
  if (t === "boolean") return Boolean(value);
  if (t === "integer") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : false;
  }
  if (t === "float") {
    const n = Number(value);
    return Number.isFinite(n) ? n : false;
  }
  if (t === "date") {
    const y = yearOf(value);
    return y ? `${y}-01-01` : String(value);
  }
  if (t === "selection") {
    const raw = String(value).trim();
    if (selection?.length) {
      const hit = selection.find(
        ([k, lab]) => k === raw || lab === raw || k === String(Number(raw)) || fold(lab) === fold(raw),
      );
      if (hit) return hit[0];
    }
    return raw;
  }
  return String(value);
}

export function mappedOdooKeys(fields: Record<string, { string?: string }>) {
  return Object.fromEntries(
    ODOO_OWNED_FIELDS.map((key) => [key, pickAllFieldsByLabel(fields, ODOO_OWNED_NEEDLES[key])]),
  );
}

export type OdooSourceSnapshot = {
  serialRaw?: string;
  productName?: string;
  productCode?: string;
  locationName?: string;
  color?: string | null;
  tareKg?: number | null;
  mgwKg?: number | null;
  year?: number | null;
  manufacturer?: string | null;
  dua?: string | null;
  originCountry?: string | null;
  material?: string | null;
  zgroupCode?: string | null;
};

export function buildOdooSource(input: OdooSourceSnapshot): OdooSourceSnapshot {
  return {
    serialRaw: input.serialRaw || "",
    productName: input.productName || "",
    productCode: input.productCode || "",
    locationName: input.locationName || "",
    color: input.color || null,
    tareKg: input.tareKg ?? null,
    mgwKg: input.mgwKg ?? null,
    year: input.year ?? null,
    manufacturer: input.manufacturer || null,
    dua: input.dua || null,
    originCountry: input.originCountry || null,
    material: input.material || null,
    zgroupCode: input.zgroupCode || null,
  };
}

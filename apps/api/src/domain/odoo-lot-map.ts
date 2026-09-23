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
  "descripcion",
  "description",
  "nota",
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
  const specificity = (key: string) => {
    const label = fold(fields[key]?.string || "");
    const tech = fold(key);
    let s = score(key) * 10;
    if (wanted.some((n) => n.includes("kg")) && (label.includes("kg") || tech.includes("kg"))) s += 8;
    return s;
  };
  return uniq.sort((a, b) => specificity(b) - specificity(a));
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
  "description",
  "zgroupCode",
  "internalRef",
  "lotCategory",
  "classification",
  "lotCode",
  "numberingDate",
  "manufactureMonth",
  "productTitle",
] as const;

/** No tienen columna propia: viven en el JSON del lote y de la unidad. */
export const ODOO_EXTRA_FIELDS = [
  "internalRef",
  "lotCategory",
  "classification",
  "lotCode",
  "numberingDate",
  "manufactureMonth",
  "productTitle",
] as const;

export function isOdooExtraField(field: string): field is (typeof ODOO_EXTRA_FIELDS)[number] {
  return (ODOO_EXTRA_FIELDS as readonly string[]).includes(field);
}

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
  description: ["descripcion", "description", "nota interna", "note"],
  zgroupCode: ["codigo zgroup"],
  internalRef: ["referencia interna"],
  lotCategory: ["category"],
  classification: ["clasificacion"],
  lotCode: ["codigo"],
  numberingDate: ["fecha de numeracion"],
  manufactureMonth: ["mes de fabricacion"],
  productTitle: ["nombre del producto"],
};

/** Claves Odoo a escribir: todos los aliases no-enable. Peso: `weight_kg` primero y también `weight`. */
export function odooWriteKeys(field: OdooOwnedField, mapped: string[] | undefined, fields?: Record<string, { string?: string }>): string[] {
  const raw = (mapped || []).filter((k) => k && !/^enable_/i.test(k));
  const fallback = fields ? ownedFieldKeys(fields, field) : [];
  const keys = [...new Set([...raw, ...fallback])];
  if (field === "mgwKg") {
    const kg = keys.filter((k) => /_kg$|weight_kg|peso_kg/i.test(k) || fold(k).includes("kg"));
    return [...new Set([...kg, ...keys])];
  }
  return keys;
}

export const ODOO_OWNED_LABELS: Record<OdooOwnedField, string> = {
  color: "Color",
  tareKg: "Tara (kg)",
  mgwKg: "Peso (kg)",
  year: "Año de fabricación",
  manufacturer: "Fabricante",
  dua: "Nº DUA",
  originCountry: "Procedencia",
  material: "Tipo material",
  description: "Descripción",
  zgroupCode: "Código ZGroup",
  internalRef: "Referencia interna",
  lotCategory: "Category",
  classification: "Clasificación",
  lotCode: "Código",
  numberingDate: "Fecha de numeración",
  manufactureMonth: "Mes de fabricación",
  productTitle: "Nombre del producto",
};

/** Código a secas no debe caer en Código ZGroup. Category no es la categoría del producto. */
export function ownedFieldKeys(fields: Record<string, { string?: string }>, field: OdooOwnedField): string[] {
  if (field === "lotCode") {
    return Object.entries(fields || {})
      .filter(([key, meta]) => !/^enable_/i.test(key) && !/zgroup/i.test(key) && !/zgroup/i.test(meta?.string || "") && (fold(meta?.string || "") === "codigo" || fold(key) === "codigo" || fold(key) === "code"))
      .map(([key]) => key);
  }
  if (field === "lotCategory") {
    return Object.entries(fields || {})
      .filter(([key, meta]) => !/^enable_/i.test(key) && fold(meta?.string || "") === "category")
      .map(([key]) => key);
  }
  if (field === "internalRef") {
    const labeled = pickAllFieldsByLabel(fields, ["referencia interna"]);
    if (fields?.ref) return [...new Set([...labeled, "ref"])];
    return labeled;
  }
  return pickAllFieldsByLabel(fields, ODOO_OWNED_NEEDLES[field]);
}

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
    for (const hit of ownedFieldKeys(fields, key)) keys.add(hit);
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
  description: string | null;
  internalRef: string | null;
  lotCategory: string | null;
  classification: string | null;
  lotCode: string | null;
  numberingDate: string | null;
  manufactureMonth: string | null;
  productTitle: string | null;
  yearToken: string | null;
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
  if (n >= 1960 && n <= 2100) return n;
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
    yearToken: scalar(get(["ano de fabricacion", "year"])),
    manufacturer: scalar(get(["fabricante", "manufacturer"])),
    dua: scalar(get(["n dua", "no dua", "nro dua", "dua"])),
    originCountry: scalar(get(["procedencia"])),
    material: scalar(get(["tipo material", "material"])),
    zgroupCode: scalar(get(["codigo zgroup"])),
    description: scalar(get(["descripcion", "description", "nota interna", "note"])),
    internalRef: scalar(lot?.ref) || scalar(get(["referencia interna"])),
    lotCategory: scalar(exact(fields, lot, "category")),
    classification: scalar(get(["clasificacion"])),
    lotCode: scalar(exact(fields, lot, "codigo")),
    numberingDate: scalar(get(["fecha de numeracion"])),
    manufactureMonth: scalar(get(["mes de fabricacion"])),
    productTitle: scalar(get(["nombre del producto"])),
  };
}

function exact(fields: Record<string, { string?: string }>, lot: Record<string, unknown> | undefined, label: string) {
  if (!lot) return null;
  for (const [key, meta] of Object.entries(fields || {})) {
    if (/zgroup/i.test(key) || /zgroup/i.test(meta?.string || "")) continue;
    if (fold(meta?.string || "") === label || fold(key) === label) {
      const v = lot[key];
      if (v != null && v !== false && v !== "") return v;
    }
  }
  return null;
}

export function ownedStorageKey(field: OdooOwnedField): "odooDescription" | Exclude<OdooOwnedField, "description"> {
  return field === "description" ? "odooDescription" : field;
}

export function receptionOwnedPatch(body: {
  tareKg?: unknown;
  mgwKg?: unknown;
  color?: unknown;
  year?: unknown;
  manufacturer?: unknown;
  odooDua?: unknown;
  originCountry?: unknown;
  material?: unknown;
  odooDescription?: unknown;
  zgroupCode?: unknown;
  internalRef?: unknown;
  lotCategory?: unknown;
  classification?: unknown;
  lotCode?: unknown;
  numberingDate?: unknown;
  manufactureMonth?: unknown;
  productTitle?: unknown;
}): Partial<Record<OdooOwnedField, string | number | null>> {
  const out: Partial<Record<OdooOwnedField, string | number | null>> = {};
  if (body.tareKg !== undefined) out.tareKg = Math.max(0, Math.round(Number(body.tareKg) || 0));
  if (body.mgwKg !== undefined) out.mgwKg = Math.max(0, Math.round(Number(body.mgwKg) || 0));
  if (body.color !== undefined) out.color = body.color == null || body.color === "" ? null : String(body.color);
  if (body.year !== undefined) {
    if (body.year == null || body.year === "") out.year = null;
    else if (/^\d+$/.test(String(body.year).trim())) out.year = Math.round(Number(body.year));
    else out.year = String(body.year).trim();
  }
  if (body.manufacturer !== undefined) out.manufacturer = body.manufacturer == null || body.manufacturer === "" ? null : String(body.manufacturer);
  if (body.odooDua !== undefined) out.dua = String(body.odooDua || "").trim() || null;
  if (body.originCountry !== undefined) out.originCountry = String(body.originCountry || "").trim() || null;
  if (body.material !== undefined) out.material = String(body.material || "").trim() || null;
  if (body.odooDescription !== undefined) out.description = String(body.odooDescription || "");
  for (const key of ["zgroupCode", "internalRef", "lotCategory", "classification", "lotCode", "numberingDate", "manufactureMonth", "productTitle"] as const) {
    if (body[key] !== undefined) out[key] = String(body[key] || "").trim() || null;
  }
  return out;
}

const ODOO_MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export const ODOO_LOT_SELECT_FALLBACK: {
  color: Array<[string, string]>;
  year: Array<[string, string]>;
  manufactureMonth: Array<[string, string]>;
} = {
  color: [
    ["BLANCO", "BLANCO"],
    ["CREMA", "CREMA"],
    ["BEIGE", "BEIGE"],
    ["ARENA", "ARENA"],
    ["CANELA", "CANELA"],
    ["TABACO", "TABACO"],
    ["AMARRILLO", "AMARRILLO"],
    ["ORO", "ORO"],
    ["NARANJA", "NARANJA"],
    ["MARRON", "MARRON"],
    ["ROSADO", "ROSADO"],
    ["MELON", "MELON"],
    ["PETALO", "PETALO"],
    ["FRESA", "FRESA"],
    ["FUCSIA", "FUCSIA"],
    ["ROJO", "ROJO"],
    ["GUINDA", "GUINDA"],
    ["VINO", "VINO"],
    ["LILA", "LILA"],
    ["VIOLETA", "VIOLETA"],
    ["ANARANJADO", "ANARANJADO"],
    ["NEGRO", "NEGRO"],
    ["BLANCO/AZUL", "BLANCO/AZUL"],
    ["BLANCO/ROJO", "BLANCO/ROJO"],
    ["BLANCO/NEGRO", "BLANCO/NEGRO"],
    ["BLANCO/GRIS", "BLANCO/GRIS"],
    ["PLOMO", "PLOMO"],
    ["ROJO OXIDO", "ROJO OXIDO"],
    ["VERDE", "VERDE"],
    ["AZUL", "AZUL"],
    ["CELESTE", "CELESTE"],
    ["NO DEFINIDO", "NO DEFINIDO"],
  ],
  year: [
    ...Array.from({ length: 67 }, (_, i) => {
      const y = String(1960 + i);
      return [y, y] as [string, string];
    }).filter(([y]) => y !== "1961"),
    ["NO DEFINE", "NO DEFINE"],
  ],
  manufactureMonth: ODOO_MONTHS.map((m) => [m, m]),
};

export function payloadExtras(payload: unknown): Record<string, string | null> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const raw = (payload as { extras?: unknown }).extras;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value == null || value === "" ? null : String(value);
  }
  return out;
}

export function withPayloadExtras(payload: unknown, patch: Record<string, string | null>) {
  const prev = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...(payload as Record<string, unknown>) } : {};
  return { ...prev, extras: { ...payloadExtras(payload), ...patch } };
}

export function lotExtraPatch(attrs: Partial<OdooLotAttrs>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of ODOO_EXTRA_FIELDS) {
    const value = attrs[key];
    if (value) out[key] = String(value);
  }
  if (attrs.yearToken) out.yearToken = attrs.yearToken;
  if (attrs.zgroupCode) out.zgroupCode = attrs.zgroupCode;
  return out;
}

export function matchOdooSelect(raw: unknown, options: Array<[string, string]> | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t || !options?.length) return "";
  const hit = options.find(([k, lab]) => k === t || lab === t || fold(k) === fold(t) || fold(lab) === fold(t));
  return hit ? hit[0] : "";
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
  if (t === "datetime") {
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw} 00:00:00`;
    const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")} 00:00:00`;
    return raw;
  }
  if (t === "selection") {
    const raw = String(value).trim();
    if (selection?.length) {
      const hit = selection.find(
        ([k, lab]) =>
          k === raw ||
          lab === raw ||
          k === String(Number(raw)) ||
          fold(k) === fold(raw) ||
          fold(lab) === fold(raw),
      );
      if (hit) return hit[0];
    }
    return raw;
  }
  return String(value);
}

export function mappedOdooKeys(fields: Record<string, { string?: string }>) {
  return Object.fromEntries(
    ODOO_OWNED_FIELDS.map((key) => [key, ownedFieldKeys(fields, key)]),
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
  description?: string | null;
  internalRef?: string | null;
  lotCategory?: string | null;
  classification?: string | null;
  lotCode?: string | null;
  numberingDate?: string | null;
  manufactureMonth?: string | null;
  productTitle?: string | null;
  yearToken?: string | null;
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
    description: input.description || null,
    internalRef: input.internalRef || null,
    lotCategory: input.lotCategory || null,
    classification: input.classification || null,
    lotCode: input.lotCode || null,
    numberingDate: input.numberingDate || null,
    manufactureMonth: input.manufactureMonth || null,
    productTitle: input.productTitle || null,
    yearToken: input.yearToken || null,
  };
}

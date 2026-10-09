/** Lee la medida y la familia desde la descripción de producto de Odoo y la compara con el tipo de ZDRY. */

export type TypeFamily = "standard" | "hc" | "ot" | "fr" | "rf" | "ht";
export type ConditionCode = "1TRIP" | "CW" | "WWT" | "ASIS";

export type TypeMaster = {
  code: string;
  label?: string;
  dims?: string;
  archivedAt?: Date | string | null;
};

export type ProductShape = {
  feet: number | null;
  family: TypeFamily | null;
  openSide: boolean;
  condition: ConditionCode | null;
  namedCode: string | null;
};

export type TypeAuditInput = {
  id: string;
  iso: string;
  source: "contenedor" | "lote";
  currentType: string;
  currentCat: string;
  productName: string;
  productCode: string;
};

export type TypeAuditRow = TypeAuditInput & {
  suggestedType: string | null;
  typeReason: string;
  suggestedCat: ConditionCode | null;
  catReason: string;
  openSide: boolean;
};

const CANONICAL: Record<string, string> = {
  "20|standard": "20GP",
  "40|standard": "40GP",
  "45|standard": "45GP",
  "20|hc": "20HC",
  "40|hc": "40HC",
  "45|hc": "45HC",
  "20|ot": "20OT",
  "40|ot": "40OT",
  "45|ot": "45OT",
  "20|fr": "20FR",
  "40|fr": "40FR",
  "45|fr": "45FR",
  "20|rf": "20RF",
  "40|rf": "40RF",
  "45|rf": "45RF",
};

const FAMILY_LABEL: Record<TypeFamily, string> = {
  standard: "standard",
  hc: "high cube",
  ot: "open top",
  fr: "flat rack",
  rf: "reefer",
  ht: "hardtop",
};

export function nominalFeet(code: string, dims = ""): { feet: number | null; mixed: boolean } {
  const fromCode = String(code || "").toUpperCase().match(/^(20|40|45)/);
  if (fromCode) return { feet: Number(fromCode[1]), mixed: false };
  const found = [...String(dims || "").matchAll(/(\d{2})'/g)].map((m) => Number(m[1]));
  const unique = [...new Set(found)];
  if (unique.length > 1) return { feet: null, mixed: true };
  if (unique.length === 1) return { feet: unique[0], mixed: false };
  return { feet: null, mixed: false };
}

export function familyOfCode(code: string): TypeFamily | null {
  const c = String(code || "").toUpperCase();
  if (c.includes("HC")) return "hc";
  if (c.includes("OT")) return "ot";
  if (c.includes("FR")) return "fr";
  if (c.includes("RF")) return "rf";
  if (c === "HT" || c.startsWith("HT")) return "ht";
  if (c.includes("GP") || c.includes("DC") || c.includes("STD")) return "standard";
  return null;
}

export function typeShape(code: string, dims = ""): { feet: number | null; family: TypeFamily | null; mixed: boolean } {
  const size = nominalFeet(code, dims);
  return { feet: size.feet, family: familyOfCode(code), mixed: size.mixed };
}

function cleanProduct(raw: string) {
  return String(raw || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function familyIn(text: string): TypeFamily | null {
  if (/\bHC\b/.test(text) || text.includes("HIGH CUBE")) return "hc";
  if (/\bOT\b/.test(text) || text.includes("OPEN TOP")) return "ot";
  if (/\bFR\b/.test(text) || text.includes("FLAT RACK") || text.includes("FLATRACK")) return "fr";
  if (/\bRF\b/.test(text) || text.includes("REEFER")) return "rf";
  if (text.includes("HARDTOP") || text.includes("HARD TOP")) return "ht";
  if (/\bDC\b/.test(text) || /\bGP\b/.test(text) || text.includes("STANDARD")) return "standard";
  if (/\bDRY\b/.test(text)) return "standard";
  return null;
}

function feetIn(text: string, family: TypeFamily | null): number | null {
  const paired = text.match(/\b(20|40|45)\s+(DC|HC|GP|OT|FR|RF|STD)\b/);
  if (paired) return Number(paired[1]);
  if (family) {
    const near = text.match(new RegExp(`\\b(20|40|45)\\b(?=\\s+(?:${family === "hc" ? "HC" : family === "ot" ? "OT" : family === "fr" ? "FR" : family === "rf" ? "RF" : "DC|GP|STD"}))`));
    if (near) return Number(near[1]);
  }
  const any = text.match(/\b(20|40|45)\b/);
  return any ? Number(any[1]) : null;
}

function namedCode(text: string): string | null {
  const hit = text.match(/\b(20|40|45)\s+(DC|HC|GP|OT|FR|RF|STD)\b/);
  if (!hit) return null;
  const suffix = hit[2] === "STD" ? "GP" : hit[2];
  return `${hit[1]}${suffix}`;
}

function conditionIn(text: string): ConditionCode | null {
  if (text.includes("1 TRIP") || text.includes("1TRIP") || /\bNUEVO\b/.test(text) || /\bNEW\b/.test(text)) return "1TRIP";
  if (text.includes("CARGO WORTHY") || /\bCW\b/.test(text)) return "CW";
  if (/\bWWT\b/.test(text) || text.includes("WIND") && text.includes("WATER")) return "WWT";
  if (text.includes("AS IS") || /\bASIS\b/.test(text) || text.includes("DANADO") || text.includes("DAMAGED")) return "ASIS";
  return null;
}

export function parseProductEquipment(name: string, code = ""): ProductShape {
  const nameText = cleanProduct(name);
  const codeText = cleanProduct(code);
  const openSide = nameText.includes("OPEN SIDE");
  const nameBody = nameText.replace(/OPEN SIDE/g, " ");
  const nameFamily = familyIn(nameBody);
  const nameFeet = feetIn(nameBody, nameFamily);
  const codeBody = codeText.replace(/OPEN SIDE/g, " ");
  const family = nameFamily || familyIn(codeBody);
  const feet = nameFeet || feetIn(codeBody, family);
  const named = namedCode(nameBody) || namedCode(codeBody);
  return {
    feet,
    family,
    openSide,
    condition: conditionIn(nameBody),
    namedCode: named,
  };
}

function activeMasters(masters: TypeMaster[]) {
  return masters.filter((row) => !row.archivedAt);
}

function sameEquipment(current: string, dims: string, shape: ProductShape) {
  if (!shape.feet || !shape.family) return false;
  const now = typeShape(current, dims);
  return now.feet === shape.feet && now.family === shape.family;
}

export function suggestTypeCode(shape: ProductShape, masters: TypeMaster[], currentType = "", currentDims = ""): { code: string; reason: string } | null {
  if (!shape.feet || !shape.family || shape.family === "ht") return null;
  if (sameEquipment(currentType, currentDims, shape)) return null;
  const live = activeMasters(masters);
  const fits = (code: string) => {
    const row = live.find((item) => item.code.toUpperCase() === code.toUpperCase());
    if (!row) return false;
    const parsed = typeShape(row.code, row.dims || "");
    return parsed.feet === shape.feet && parsed.family === shape.family;
  };
  const named = shape.namedCode && fits(shape.namedCode) ? shape.namedCode.toUpperCase() : "";
  const canonical = CANONICAL[`${shape.feet}|${shape.family}`] || "";
  const fallback = live.find((row) => {
    const parsed = typeShape(row.code, row.dims || "");
    return parsed.feet === shape.feet && parsed.family === shape.family;
  });
  const code = named || (fits(canonical) ? canonical : "") || fallback?.code || "";
  if (!code) return null;
  const current = typeShape(currentType, currentDims);
  const from = current.feet ? `${currentType} (${current.feet} pies, ${FAMILY_LABEL[current.family || "standard"]})` : currentType || "sin tipo";
  const open = shape.openSide ? " Open side no es open top." : "";
  const alias = named && named !== code ? "" : shape.namedCode && shape.namedCode !== code
    ? ` ${shape.namedCode} no está en los maestros; se usa ${code}, la misma medida.`
    : "";
  return {
    code,
    reason: `El producto describe ${shape.feet} pies ${FAMILY_LABEL[shape.family]} y el tipo actual es ${from}.${alias}${open}`.replace(/\s+/g, " ").trim(),
  };
}

export function auditEquipment(row: TypeAuditInput, masters: TypeMaster[]): TypeAuditRow | null {
  const shape = parseProductEquipment(row.productName, row.productCode);
  const currentMaster = masters.find((item) => item.code.toUpperCase() === String(row.currentType || "").toUpperCase());
  const suggestion = suggestTypeCode(shape, masters, row.currentType, currentMaster?.dims || "");
  let suggestedCat: ConditionCode | null = null;
  let catReason = "";
  if (shape.condition && shape.condition !== String(row.currentCat || "").toUpperCase()) {
    suggestedCat = shape.condition;
    catReason = `La descripción indica ${shape.condition} y la condición actual es ${row.currentCat || "vacía"}. No se aplica salvo que se marque.`;
  }
  if (!suggestion && !suggestedCat) return null;
  return {
    ...row,
    suggestedType: suggestion?.code || null,
    typeReason: suggestion?.reason || "",
    suggestedCat,
    catReason,
    openSide: shape.openSide,
  };
}

export function canonicalTypeFromProduct(name: string, code: string, fallback = "40HC") {
  const shape = parseProductEquipment(name, code);
  if (!shape.feet || !shape.family || shape.family === "ht") return fallback;
  return CANONICAL[`${shape.feet}|${shape.family}`] || fallback;
}

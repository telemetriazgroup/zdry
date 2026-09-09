export const DEFAULT_EVAL_LEVELS = [
  { key: "excelente", label: "Excelente", sortOrder: 10, color: "#2f9e44" },
  { key: "bueno", label: "Bueno", sortOrder: 20, color: "#1971c2" },
  { key: "regular", label: "Regular", sortOrder: 30, color: "#c9720b" },
  { key: "malo", label: "Malo", sortOrder: 40, color: "#c92a2a" },
] as const;

export const DEFAULT_EVAL_CONCEPTS = [
  { key: "floor", label: "Piso", sortOrder: 10, legacyField: "conditionFloor" },
  { key: "roof", label: "Techo", sortOrder: 20, legacyField: "conditionRoof" },
  { key: "walls", label: "Paredes", sortOrder: 30, legacyField: "conditionWalls" },
  { key: "doors", label: "Puertas", sortOrder: 40, legacyField: "conditionDoors" },
  { key: "paint", label: "Pintura", sortOrder: 50, legacyField: "conditionPaint" },
] as const;

export const LEGACY_FIELD_BY_CONCEPT: Record<string, string> = {
  floor: "conditionFloor",
  roof: "conditionRoof",
  walls: "conditionWalls",
  doors: "conditionDoors",
  paint: "conditionPaint",
};

export const CONCEPT_BY_LEGACY_FIELD: Record<string, string> = {
  conditionFloor: "floor",
  conditionRoof: "roof",
  conditionWalls: "walls",
  conditionDoors: "doors",
  conditionPaint: "paint",
};

export type EvalSource = "patio" | "recepcion" | "catalogo";

export function slugEvalKey(raw: string, fallback: string) {
  const key = String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return key || fallback;
}

export function parseEvalColor(raw: unknown) {
  const t = String(raw || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(t) ? t.toLowerCase() : "#5c6370";
}

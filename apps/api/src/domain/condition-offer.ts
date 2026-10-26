import { referentialUsage } from "./dry-referential";

export const CLIENT_NUEVO_LABEL = "Nuevo & 1 trip";
export const CLIENT_SEGUNDO_LABEL = "Segundo uso";

export const EVAL_POINTS: Record<string, number> = {
  malo: 1,
  regular: 2,
  bueno: 4,
  excelente: 5,
};

export const OFFER_CONDITION_KEY = "offer_condition_rules";

export type OfferConditionRule = {
  id: string;
  fromCat: string;
  minAverage: number;
  toCat: string;
};

export type OfferConditionConfig = {
  points: { malo: number; regular: number; bueno: number; excelente: number };
  rules: OfferConditionRule[];
};

export function defaultOfferConditionConfig(): OfferConditionConfig {
  return {
    points: { ...EVAL_POINTS } as OfferConditionConfig["points"],
    rules: [
      { id: "any-cw", fromCat: "*", minAverage: 4, toCat: "CW" },
      { id: "asis-wwt", fromCat: "ASIS", minAverage: 2, toCat: "WWT" },
    ],
  };
}

export function normalizeOfferConditionConfig(raw: unknown): OfferConditionConfig {
  const base = defaultOfferConditionConfig();
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawPoints = src.points && typeof src.points === "object" && !Array.isArray(src.points) ? (src.points as Record<string, unknown>) : {};
  const points = { ...base.points };
  for (const key of ["malo", "regular", "bueno", "excelente"] as const) {
    const n = Number(rawPoints[key]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) points[key] = Math.round(n * 100) / 100;
  }
  if (!Array.isArray(src.rules)) return { points, rules: base.rules };
  const rules: OfferConditionRule[] = [];
  for (const row of src.rules) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const fromRaw = String(item.fromCat || "").trim().toUpperCase();
    const toCat = String(item.toCat || "").trim().toUpperCase();
    const minAverage = Number(item.minAverage);
    if (!fromRaw || !toCat || !Number.isFinite(minAverage) || minAverage < 0 || minAverage > 100) continue;
    rules.push({
      id: String(item.id || "").trim().slice(0, 40) || `r-${rules.length + 1}`,
      fromCat: fromRaw === "*" ? "*" : fromRaw,
      minAverage: Math.round(minAverage * 100) / 100,
      toCat,
    });
  }
  return { points, rules };
}

const CONDITION_RANK: Record<string, number> = {
  ASIS: 1,
  WWT: 2,
  CW: 3,
};

export function isClientNuevo(cat: string | null | undefined): boolean {
  if (referentialUsage(cat) === "nuevo") return true;
  const c = String(cat || "").trim().toUpperCase().replace(/\s+/g, " ");
  return c.includes("1 TRIP") || c.includes("1-TRIP") || c.includes("1TRIP");
}

export function clientCondition(cat: string | null | undefined): { code: "nuevo" | "segundo"; label: string } {
  if (isClientNuevo(cat)) return { code: "nuevo", label: CLIENT_NUEVO_LABEL };
  return { code: "segundo", label: CLIENT_SEGUNDO_LABEL };
}

export function evalPoints(levelKey: string | null | undefined): number | null {
  const key = String(levelKey || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(EVAL_POINTS, key) ? EVAL_POINTS[key] : null;
}

export function evaluationAverage(
  levelKeys: Array<string | null | undefined>,
  points: Record<string, number> = EVAL_POINTS,
): number | null {
  const scored = levelKeys
    .map((level) => {
      const key = String(level || "").trim().toLowerCase();
      const n = points[key];
      return Number.isFinite(n) ? n : null;
    })
    .filter((n): n is number => n != null);
  if (!scored.length) return null;
  return Math.round((scored.reduce((sum, n) => sum + n, 0) / scored.length) * 100) / 100;
}

/** Sube la condición documental solo si una regla lo justifica. Sin evaluación, se queda igual. */
export function promotedCondition(
  documentCat: string | null | undefined,
  average: number | null,
  config: OfferConditionConfig = defaultOfferConditionConfig(),
): string {
  const doc = String(documentCat || "").trim().toUpperCase();
  if (!doc || average == null || isClientNuevo(doc)) return doc;
  const docRank = CONDITION_RANK[doc] ?? null;
  const matches = config.rules
    .filter((rule) => average >= rule.minAverage && (rule.fromCat === "*" || rule.fromCat === doc))
    .sort((a, b) => b.minAverage - a.minAverage || (CONDITION_RANK[b.toCat] ?? 0) - (CONDITION_RANK[a.toCat] ?? 0));
  for (const rule of matches) {
    const targetRank = CONDITION_RANK[rule.toCat] ?? null;
    if (targetRank != null && (docRank == null ? targetRank <= 0 : targetRank <= docRank)) continue;
    if (targetRank == null && rule.toCat === doc) continue;
    return rule.toCat;
  }
  return doc;
}

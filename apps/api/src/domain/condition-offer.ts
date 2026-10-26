import { referentialUsage } from "./dry-referential";

export const CLIENT_NUEVO_LABEL = "Nuevo & 1 trip";
export const CLIENT_SEGUNDO_LABEL = "Segundo uso";

export const EVAL_POINTS: Record<string, number> = {
  malo: 1,
  regular: 2,
  bueno: 4,
  excelente: 5,
};

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

export function evaluationAverage(levelKeys: Array<string | null | undefined>): number | null {
  const points = levelKeys.map(evalPoints).filter((n): n is number => n != null);
  if (!points.length) return null;
  return Math.round((points.reduce((sum, n) => sum + n, 0) / points.length) * 100) / 100;
}

/** Sube la condición documental solo si la evaluación lo justifica. No baja ni toca un nuevo. */
export function promotedCondition(documentCat: string | null | undefined, average: number | null): string {
  const doc = String(documentCat || "").trim().toUpperCase();
  if (!doc || average == null || isClientNuevo(doc)) return doc;
  let target = doc;
  if (average >= 4) target = "CW";
  else if (average >= 2 && doc === "ASIS") target = "WWT";
  const docRank = CONDITION_RANK[doc] ?? 0;
  const targetRank = CONDITION_RANK[target] ?? 0;
  if (targetRank > docRank) return target;
  return doc;
}

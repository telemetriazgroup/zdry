export const ODOO_WATCH_KEY = "odoo_import_watch";
export const ODOO_WATCH_MS = 5 * 60 * 1000;

export type OdooWatchMode = "manual" | "auto";

export type OdooWatchState = {
  mode: OdooWatchMode;
  lastRunAt: string | null;
  lastMessage: string;
  lastNew: number;
  lastAssimilated: number;
};

export function normalizeOdooWatch(raw: unknown): OdooWatchState {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lastNew = Number(src.lastNew);
  const lastAssimilated = Number(src.lastAssimilated);
  return {
    mode: src.mode === "auto" ? "auto" : "manual",
    lastRunAt: typeof src.lastRunAt === "string" && src.lastRunAt ? src.lastRunAt : null,
    lastMessage: typeof src.lastMessage === "string" ? src.lastMessage.slice(0, 300) : "",
    lastNew: Number.isFinite(lastNew) && lastNew > 0 ? Math.round(lastNew) : 0,
    lastAssimilated: Number.isFinite(lastAssimilated) && lastAssimilated > 0 ? Math.round(lastAssimilated) : 0,
  };
}

/** Lotes de Odoo que todavía no están en ZDRY. */
export function freshOdooLotIds(seen: number[], known: Iterable<number>): number[] {
  const have = new Set(known);
  const out: number[] = [];
  const used = new Set<number>();
  for (const id of seen) {
    if (!id || used.has(id) || have.has(id)) continue;
    used.add(id);
    out.push(id);
  }
  return out;
}

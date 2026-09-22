import { limaDayRange } from "../odoo/odoo-lot-photos";

export function limaYmd(value: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(value));
}

export function limaLastDays(days = 14): string[] {
  const n = Math.max(1, Math.min(60, Number(days) || 14));
  const today = limaDayRange().start;
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() + i * -86400000);
    out.push(limaYmd(d));
  }
  return out;
}

export function countByDay(dates: Array<Date | string | null | undefined>, days = 14): { date: string; count: number }[] {
  const keys = limaLastDays(days);
  const map = new Map(keys.map((k) => [k, 0]));
  for (const raw of dates) {
    if (!raw) continue;
    const key = limaYmd(raw);
    if (map.has(key)) map.set(key, (map.get(key) || 0) + 1);
  }
  return keys.map((date) => ({ date, count: map.get(date) || 0 }));
}

export type CostBucket = { key: string; units: number; cost: number; extras: number; base: number };

export function addCostBucket(map: Map<string, CostBucket>, key: string, cost: number, extras: number) {
  const label = (key || "Sin dato").trim() || "Sin dato";
  const row = map.get(label) || { key: label, units: 0, cost: 0, extras: 0, base: 0 };
  row.units += 1;
  row.cost += Number(cost) || 0;
  row.extras += Number(extras) || 0;
  row.base = Math.round((row.cost + row.extras) * 100) / 100;
  map.set(label, row);
}

export function rankCostBuckets(map: Map<string, CostBucket>, take = 8): CostBucket[] {
  return [...map.values()]
    .map((r) => ({
      ...r,
      cost: Math.round(r.cost * 100) / 100,
      extras: Math.round(r.extras * 100) / 100,
      base: Math.round(r.base * 100) / 100,
    }))
    .sort((a, b) => b.base - a.base || b.units - a.units)
    .slice(0, take);
}

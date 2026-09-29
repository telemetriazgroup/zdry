/** El tipo que queda conserva sus reglas. El absorbido se reescribe hacia él y, si choca, se descarta. */

export function parseTypeMerge(body: { keep?: unknown; absorb?: unknown }): { keep: string; absorb: string[] } {
  const keep = String(body.keep || "").trim().toUpperCase();
  const raw = Array.isArray(body.absorb) ? body.absorb : [body.absorb];
  const absorb: string[] = [];
  for (const item of raw) {
    const code = String(item || "").trim().toUpperCase();
    if (!code || code === keep || absorb.includes(code)) continue;
    absorb.push(code);
  }
  return { keep, absorb };
}

export function retargetTypeRows<T>(
  rows: T[],
  field: keyof T,
  absorb: string[],
  keep: string,
  identity: (row: T) => string,
): T[] {
  const from = new Set(absorb.map((code) => code.toUpperCase()));
  const taken = new Set(rows.filter((row) => !from.has(String(row[field] ?? "").toUpperCase())).map(identity));
  const out: T[] = [];
  for (const row of rows) {
    const wasAbsorbed = from.has(String(row[field] ?? "").toUpperCase());
    const next = wasAbsorbed ? ({ ...row, [field]: keep } as T) : row;
    const key = identity(next);
    if (wasAbsorbed && taken.has(key)) continue;
    if (wasAbsorbed) taken.add(key);
    out.push(next);
  }
  return out;
}

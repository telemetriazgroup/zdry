export type AssimilateLogLevel = "ok" | "error" | "warn" | "info";

export type AssimilateLogDraft = {
  level: AssimilateLogLevel;
  step: string;
  iso?: string;
  serialRaw?: string;
  odooLotId?: number | null;
  product?: string;
  message: string;
  detail?: string;
};

export function errorDetail(err: unknown): { message: string; detail: string } {
  const e = err as Error & { cause?: unknown };
  const message = String(e?.message || err || "Error desconocido").slice(0, 800);
  const parts = [e?.stack || ""];
  if (e?.cause) parts.push(`cause: ${typeof e.cause === "string" ? e.cause : JSON.stringify(e.cause)}`);
  return { message, detail: parts.filter(Boolean).join("\n\n").slice(0, 8000) };
}

export function presentAssimilateRun(run: {
  id: string;
  kind: string;
  status: string;
  startedAt: Date | string;
  endedAt?: Date | string | null;
  startedBy?: string | null;
  okCount: number;
  errorCount: number;
  skipCount: number;
  message: string;
}) {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    startedAt: typeof run.startedAt === "string" ? run.startedAt : run.startedAt.toISOString(),
    endedAt: run.endedAt ? (typeof run.endedAt === "string" ? run.endedAt : run.endedAt.toISOString()) : null,
    startedBy: run.startedBy || null,
    okCount: run.okCount,
    errorCount: run.errorCount,
    skipCount: run.skipCount,
    message: run.message,
  };
}

export function isStaleRunning(startedAt: Date | string, maxMs = 40 * 60 * 1000) {
  const t = typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime();
  return Date.now() - t > maxMs;
}

export function dayStart(raw?: string | null) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dayEnd(raw?: string | null) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function csvCell(v: unknown) {
  const t = String(v ?? "").replace(/\r?\n/g, " ");
  if (/[",;]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

export function assimilateLogCsv(rows: Array<{
  createdAt: string;
  level: string;
  step: string;
  iso: string;
  serialRaw: string;
  odooLotId?: number | null;
  product: string;
  message: string;
  detail: string;
}>) {
  const head = ["fecha", "nivel", "paso", "serie", "serial", "lote_odoo", "producto", "mensaje", "detalle"];
  const lines = rows.map((e) =>
    [e.createdAt, e.level, e.step, e.iso, e.serialRaw, e.odooLotId ?? "", e.product, e.message, e.detail].map(csvCell).join(";"),
  );
  return `\uFEFF${[head.join(";"), ...lines].join("\n")}\n`;
}

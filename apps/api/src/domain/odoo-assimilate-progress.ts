export const ODOO_ASSIMILATE_PROGRESS_KEY = "odoo_assimilate_progress";

export type AssimilateProgress = {
  status: "idle" | "running" | "done" | "error";
  step: string;
  current: number;
  total: number;
  iso: string;
  message: string;
  updatedAt: string;
};

export function idleAssimilateProgress(): AssimilateProgress {
  return { status: "idle", step: "", current: 0, total: 0, iso: "", message: "", updatedAt: "" };
}

export function normalizeAssimilateProgress(raw: unknown): AssimilateProgress {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const status = src.status === "running" || src.status === "done" || src.status === "error" ? src.status : "idle";
  return {
    status,
    step: String(src.step || ""),
    current: Number(src.current) || 0,
    total: Number(src.total) || 0,
    iso: String(src.iso || ""),
    message: String(src.message || ""),
    updatedAt: String(src.updatedAt || ""),
  };
}

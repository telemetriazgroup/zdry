/** Q1: RUC para cotizar (no para crear cuenta). Tope para no usar ZDRY como extractor SUNAT. */

export const RUC_LOOKUP_MAX = 5;
export const RUC_LOOKUP_LOCK_MS = 3 * 60 * 60 * 1000;

export type RucLookupState = {
  attempts: number;
  lockedUntil: Date | string | null;
};

export type RucLookupGate =
  | { ok: true; remaining: number; lockedUntil: null }
  | { ok: false; remaining: 0; lockedUntil: Date; retryAt: string; message: string };

export type SunatRucPayload = {
  vat?: string | null;
  name?: string | null;
  street?: string | null;
  district?: string | null;
  province?: string | null;
  department?: string | null;
  taxpayer_state?: string | null;
  taxpayer_condition?: string | null;
  RazonSocial?: string | null;
  Direccion?: string | null;
  Distrito?: string | null;
  Provincia?: string | null;
  Departamento?: string | null;
  EstadoContribuyente?: string | null;
  CondicionContribuyente?: string | null;
};

export type MappedSunatRuc = {
  ruc: string;
  companyName: string;
  street: string;
  district: string;
  province: string;
  sunatState: string;
  sunatCondition: string;
};

export function digitsOnly(raw: unknown): string {
  return String(raw || "").replace(/\D/g, "");
}

export function normalizeRuc(raw: unknown): string | null {
  const d = digitsOnly(raw);
  return d.length === 11 ? d : null;
}

export function lockRemainingMs(lockedUntil: Date | string | null | undefined, now = new Date()): number {
  if (!lockedUntil) return 0;
  const t = lockedUntil instanceof Date ? lockedUntil.getTime() : new Date(lockedUntil).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, t - now.getTime());
}

export function rucLookupGate(state: RucLookupState, now = new Date()): RucLookupGate {
  const leftMs = lockRemainingMs(state.lockedUntil, now);
  if (leftMs > 0) {
    const lockedUntil = state.lockedUntil instanceof Date ? state.lockedUntil : new Date(String(state.lockedUntil));
    const mins = Math.max(1, Math.ceil(leftMs / 60000));
    return {
      ok: false,
      remaining: 0,
      lockedUntil,
      retryAt: lockedUntil.toISOString(),
      message: `Alcanzaste el máximo de ${RUC_LOOKUP_MAX} consultas SUNAT. Podrás validar de nuevo en ${mins} min.`,
    };
  }
  const expired = Boolean(state.lockedUntil);
  const spent = expired ? 0 : Number(state.attempts) || 0;
  if (spent >= RUC_LOOKUP_MAX) {
    const lockedUntil = new Date(now.getTime() + RUC_LOOKUP_LOCK_MS);
    return {
      ok: false,
      remaining: 0,
      lockedUntil,
      retryAt: lockedUntil.toISOString(),
      message: `Alcanzaste el máximo de ${RUC_LOOKUP_MAX} consultas SUNAT. Podrás validar de nuevo en 3 horas.`,
    };
  }
  return { ok: true, remaining: RUC_LOOKUP_MAX - spent, lockedUntil: null };
}

export function nextRucLookupState(state: RucLookupState, now = new Date()): { attempts: number; lockedUntil: Date | null } {
  const gate = rucLookupGate(state, now);
  if (!gate.ok) {
    return { attempts: RUC_LOOKUP_MAX, lockedUntil: gate.lockedUntil };
  }
  const spent = RUC_LOOKUP_MAX - gate.remaining;
  const nextAttempts = spent + 1;
  if (nextAttempts >= RUC_LOOKUP_MAX) {
    return { attempts: nextAttempts, lockedUntil: new Date(now.getTime() + RUC_LOOKUP_LOCK_MS) };
  }
  return { attempts: nextAttempts, lockedUntil: null };
}

export function mapSunatRuc(raw: SunatRucPayload | null | undefined, fallbackRuc: string): MappedSunatRuc | null {
  const src = raw && typeof raw === "object" ? raw : {};
  const ruc = normalizeRuc(src.vat || fallbackRuc);
  const companyName = String(src.name || src.RazonSocial || "").trim();
  if (!ruc || !companyName) return null;
  const street = String(src.street || src.Direccion || "").trim();
  const district = String(src.district || src.Distrito || "").trim();
  const province = String(src.province || src.Provincia || src.department || src.Departamento || "").trim();
  return {
    ruc,
    companyName,
    street,
    district,
    province,
    sunatState: String(src.taxpayer_state || src.EstadoContribuyente || "").trim(),
    sunatCondition: String(src.taxpayer_condition || src.CondicionContribuyente || "").trim(),
  };
}

export function missingQuoteFields(p: {
  companyName?: string | null;
  rucDni?: string | null;
  rucValidatedAt?: Date | string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
}): string[] {
  const miss: string[] = [];
  if (!normalizeRuc(p.rucDni) || !p.rucValidatedAt) miss.push("RUC validado en SUNAT");
  if (!String(p.companyName || "").trim()) miss.push("razón social");
  if (!String(p.contactName || "").trim()) miss.push("persona de contacto");
  if (!String(p.email || "").trim()) miss.push("correo");
  if (!String(p.phone || "").trim()) miss.push("teléfono");
  return miss;
}

export function missingAccountFields(p: { contactName?: string | null; email?: string | null; phone?: string | null }): string[] {
  const miss: string[] = [];
  if (!String(p.contactName || "").trim()) miss.push("persona de contacto");
  if (!String(p.email || "").trim()) miss.push("correo");
  if (!String(p.phone || "").trim()) miss.push("teléfono");
  return miss;
}

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
  ok?: boolean;
  source?: string | null;
  vat?: string | null;
  ruc?: string | null;
  Ruc?: string | null;
  name?: string | null;
  street?: string | null;
  district?: string | null;
  province?: string | null;
  department?: string | null;
  ubigeo?: string | null;
  taxpayer_state?: string | null;
  taxpayer_condition?: string | null;
  data?: SunatRucPayload | null;
  result?: SunatRucPayload | null;
  RazonSocial?: string | null;
  razonSocial?: string | null;
  nombre?: string | null;
  Direccion?: string | null;
  direccion?: string | null;
  domicilio_fiscal?: string | null;
  Distrito?: string | null;
  distrito?: string | null;
  Provincia?: string | null;
  provincia?: string | null;
  Departamento?: string | null;
  departamento?: string | null;
  Ubigeo?: string | null;
  EstadoContribuyente?: string | null;
  estado?: string | null;
  CondicionContribuyente?: string | null;
  condicion?: string | null;
};

export type MappedSunatRuc = {
  ruc: string;
  companyName: string;
  street: string;
  district: string;
  province: string;
  department: string;
  ubigeo: string;
  sunatState: string;
  sunatCondition: string;
  source: string;
};

const PLACEHOLDER_STATES = /^(SIN_ODOO|SIN_METODO)$/i;

function asText(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function firstText(src: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const t = asText(src[key]);
    if (t) return t;
  }
  return "";
}

export function unwrapSunatPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const nested = [src.data, src.result, src.sunat, src.contribuyente].find(
    (n) => n && typeof n === "object" && !Array.isArray(n),
  ) as Record<string, unknown> | undefined;
  return nested ? { ...src, ...nested } : src;
}

export function digitsOnly(raw: unknown): string {
  return String(raw || "").replace(/\D/g, "");
}

export function normalizeRuc(raw: unknown): string | null {
  const d = digitsOnly(raw);
  return d.length === 11 ? d : null;
}

/** Dígito verificador SUNAT (RUC 11). */
export function isValidPeruRuc(raw: unknown): boolean {
  const ruc = normalizeRuc(raw);
  if (!ruc) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((s, f, i) => s + f * Number(ruc[i]), 0);
  const mod = 11 - (sum % 11);
  const chk = mod === 10 ? 0 : mod === 11 ? 1 : mod;
  return chk === Number(ruc[10]);
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
  const src = unwrapSunatPayload(raw);
  const ruc = normalizeRuc(src.vat || src.ruc || src.Ruc || fallbackRuc);
  const companyName = firstText(src, ["name", "RazonSocial", "razonSocial", "nombre", "nombre_o_razon_social"]);
  if (!ruc || !companyName) return null;
  const street = firstText(src, ["street", "Direccion", "direccion", "domicilio_fiscal", "address"]);
  const district = firstText(src, ["district", "Distrito", "distrito"]);
  const province = firstText(src, ["province", "Provincia", "provincia"]);
  const department = firstText(src, ["department", "Departamento", "departamento"]);
  return {
    ruc,
    companyName,
    street,
    district,
    province,
    department,
    ubigeo: firstText(src, ["ubigeo", "Ubigeo"]),
    sunatState: firstText(src, ["taxpayer_state", "EstadoContribuyente", "estado", "estado_del_contribuyente"]),
    sunatCondition: firstText(src, ["taxpayer_condition", "CondicionContribuyente", "condicion", "condicion_de_domicilio"]),
    source: firstText(src, ["source"]) || "sunat",
  };
}

export function sunatAddressLine(p: {
  street?: string | null;
  district?: string | null;
  province?: string | null;
  department?: string | null;
}): string {
  return [p.street, p.district, p.province, p.department].map((x) => asText(x)).filter(Boolean).join(", ");
}

export function sunatNeedsRefresh(p: {
  rucDni?: string | null;
  street?: string | null;
  sunatState?: string | null;
}): boolean {
  if (!normalizeRuc(p.rucDni)) return false;
  if (PLACEHOLDER_STATES.test(String(p.sunatState || ""))) return true;
  return !asText(p.street) || !asText(p.sunatState);
}

export function presentSunat(p: {
  rucDni?: string | null;
  companyName?: string | null;
  street?: string | null;
  district?: string | null;
  province?: string | null;
  department?: string | null;
  sunatState?: string | null;
  sunatCondition?: string | null;
  sunatUbigeo?: string | null;
}) {
  const state = asText(p.sunatState);
  const fake = PLACEHOLDER_STATES.test(state);
  return {
    ruc: normalizeRuc(p.rucDni) || asText(p.rucDni),
    companyName: asText(p.companyName),
    street: asText(p.street),
    district: asText(p.district),
    province: asText(p.province),
    department: asText(p.department),
    ubigeo: asText(p.sunatUbigeo),
    sunatState: fake ? "" : state,
    sunatCondition: asText(p.sunatCondition),
    address: sunatAddressLine(p),
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

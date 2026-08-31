/** Reglas de Incoterm / logística / extras — oráculo: zdry_prototype_26.html */

export const INCOTERMS = [
  { code: "EXW", label: "EXW — En fábrica (todo el transporte corre por ZDRY)" },
  { code: "FOB", label: "FOB — Libre a bordo (ZDRY asume flete marítimo y desde el puerto)" },
  { code: "CFR", label: "CFR — Costo y flete (flete marítimo incluido, seguro no)" },
  { code: "CIF", label: "CIF — Costo, seguro y flete (flete marítimo y seguro incluidos)" },
  { code: "DAP", label: "DAP — Entregado en lugar (el proveedor asume hasta el destino, sin descargar)" },
  { code: "DDP", label: "DDP — Entregado con derechos pagados (el proveedor asume todo, incluida nacionalización)" },
] as const;

export const PURCHASE_LOGISTICS_OPTIONS = [
  { key: "reentrega", label: "Reentrega — no pago flete ni gate out" },
  { key: "recojo_flete", label: "Voy a recoger — pago flete" },
  { key: "recojo_flete_gateout", label: "Voy a recoger — pago flete y gate out" },
] as const;

export type LogisticsKey = (typeof PURCHASE_LOGISTICS_OPTIONS)[number]["key"];

export const PURCHASE_EXTRA_SERVICES = [
  { key: "agente_aduana", label: "Agente de Aduana", mandatory: true, defaultProviderType: "Agente Aduana" },
  { key: "transporte", label: "Transporte / Flete", mandatory: false, defaultProviderType: "Transporte" },
  { key: "gate_out", label: "Gate Out", mandatory: false, defaultProviderType: "Almacén Extraportuario" },
  { key: "thc", label: "THC (Terminal Handling Charge)", mandatory: false, defaultProviderType: "Agente Portuario" },
  { key: "agente_portuario", label: "Agente Portuario", mandatory: false, defaultProviderType: "Agente Portuario" },
  { key: "vistos_buenos", label: "Vistos Buenos", mandatory: false, defaultProviderType: "Agente Aduana" },
  { key: "bl", label: "Gasto de BL (naviera)", mandatory: false, defaultProviderType: "Transporte" },
] as const;

export type ExtraKey = (typeof PURCHASE_EXTRA_SERVICES)[number]["key"];
export type ExtraState = { enabled: boolean };
export type ExtrasMap = Record<string, ExtraState>;

export function purchaseFleteIncluded(logistics: string): boolean {
  return logistics === "reentrega";
}

export function purchaseGateOutIncluded(logistics: string): boolean {
  return logistics !== "recojo_flete_gateout";
}

export function purchaseExtraLocked(svc: { mandatory?: boolean; key: string }, logistics: string): boolean {
  return !!svc.mandatory || logistics === "reentrega";
}

export function defaultPurchaseExtras(logistics: string): ExtrasMap {
  const fleteIncl = purchaseFleteIncluded(logistics);
  const gateOutIncl = purchaseGateOutIncluded(logistics);
  const extras: ExtrasMap = {};
  for (const s of PURCHASE_EXTRA_SERVICES) {
    let enabled: boolean;
    if (s.mandatory) enabled = true;
    else if (s.key === "transporte") enabled = !fleteIncl;
    else if (s.key === "gate_out") enabled = !gateOutIncl;
    else enabled = false;
    extras[s.key] = { enabled };
  }
  return extras;
}

/** El cliente no puede desmarcar el agente de aduana ni alterar extras bloqueados por la logística. */
export function normalizePurchaseExtras(logistics: string, client?: Record<string, { enabled?: boolean }> | null): ExtrasMap {
  const extras = defaultPurchaseExtras(logistics);
  for (const s of PURCHASE_EXTRA_SERVICES) {
    if (purchaseExtraLocked(s, logistics)) continue;
    const next = client?.[s.key]?.enabled;
    if (typeof next === "boolean") extras[s.key].enabled = next;
  }
  extras.agente_aduana.enabled = true;
  return extras;
}

export const MANUFACTURERS = [
  "CIMC",
  "Singamas",
  "CXIC",
  "Maersk Container Industry",
  "Hyundai Translead",
];

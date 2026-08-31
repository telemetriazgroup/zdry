/** Reglas de Incoterm / logística / extras — oráculo: zdry_prototype_26.html */

export const PURCHASE_EXTRA_SERVICES = [
  { key: "agente_aduana", label: "Agente de Aduana", mandatory: true },
  { key: "transporte", label: "Transporte / Flete", mandatory: false },
  { key: "gate_out", label: "Gate Out", mandatory: false },
  { key: "thc", label: "THC (Terminal Handling Charge)", mandatory: false },
  { key: "agente_portuario", label: "Agente Portuario", mandatory: false },
  { key: "vistos_buenos", label: "Vistos Buenos", mandatory: false },
  { key: "bl", label: "Gasto de BL (naviera)", mandatory: false },
];

export function purchaseFleteIncluded(logistics) {
  return logistics === "reentrega";
}

export function purchaseGateOutIncluded(logistics) {
  return logistics !== "recojo_flete_gateout";
}

export function purchaseExtraLocked(svc, logistics) {
  return !!svc.mandatory || logistics === "reentrega";
}

export function defaultPurchaseExtras(logistics) {
  const fleteIncl = purchaseFleteIncluded(logistics);
  const gateOutIncl = purchaseGateOutIncluded(logistics);
  const extras = {};
  for (const s of PURCHASE_EXTRA_SERVICES) {
    let enabled;
    if (s.mandatory) enabled = true;
    else if (s.key === "transporte") enabled = !fleteIncl;
    else if (s.key === "gate_out") enabled = !gateOutIncl;
    else enabled = false;
    extras[s.key] = { enabled };
  }
  return extras;
}

export function extraStatusLabel(status) {
  if (status === "included") return { text: "✓ incluido / no aplica", color: "#2f9e44" };
  if (status === "pending") return { text: "⏳ pendiente de registrar", color: "#c9720b" };
  if (status === "unpaid") return { text: "Pendiente de pago", color: "#c9720b" };
  if (status === "paid") return { text: "✓ Pagado", color: "#2f9e44" };
  return { text: status || "—", color: "#5c6370" };
}

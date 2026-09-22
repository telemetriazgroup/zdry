export function originKind(r) {
  return r?.odooIntakeKind || (r?.odooPoName ? "purchase" : "unknown");
}

export function originBadge(r) {
  const kind = originKind(r);
  if (kind === "purchase") {
    return { label: r.odooPoName || r.odooPickingName || "OC", color: "#1c7ed6" };
  }
  if (kind === "fabrication") {
    return { label: r.odooMoName || r.odooPickingName || "Fabricación", color: "#7048e8" };
  }
  if (kind === "adjustment") {
    return { label: "Ajuste", color: "#e8590c" };
  }
  return { label: "Sin origen", color: "#868e96" };
}

function normType(v) {
  return String(v || "").trim().toUpperCase();
}

function normSku(v) {
  return String(v || "").trim().toUpperCase().replace(/[\[\]]/g, "");
}

function normWh(v) {
  return String(v || "").trim().toUpperCase();
}

export function referentialUsage(cat) {
  const c = String(cat || "").trim().toUpperCase();
  if (c === "1TRIP" || c === "NUEVO" || c === "NEW" || c.includes("NUEVO")) return "nuevo";
  return "segundo_uso";
}

function inferType(name, code) {
  const hay = `${code || ""} ${name || ""}`.toUpperCase();
  if (hay.includes("45") && (hay.includes("HC") || hay.includes("HIGH"))) return "45HC";
  if (hay.includes("40") && (hay.includes("HC") || hay.includes("HIGH"))) return "40HC";
  if (hay.includes("40")) return "40GP";
  if (hay.includes("20") && (hay.includes("OT") || hay.includes("OPEN"))) return "20OT";
  if (hay.includes("20")) return "20GP";
  return "";
}

function inferCat(name) {
  const hay = String(name || "").toUpperCase();
  if (hay.includes("1-TRIP") || hay.includes("1 TRIP") || hay.includes("NUEVO") || hay.includes("NEW")) return "1TRIP";
  if (hay.includes("CARGO WORTHY") || hay.includes(" CW") || hay.includes("SEGUNDO USO")) return "CW";
  if (hay.includes("WWT") || hay.includes("WIND")) return "WWT";
  return "";
}

export function lookupUnitReferential(r, referential) {
  if (r?.referentialHit?.amount > 0) return r.referentialHit;
  const buckets = referential?.buckets || [];
  const type = normType(r?.zdryType || r?.type || inferType(r?.productName, r?.productCode));
  const usage = referentialUsage(r?.zdryCat || r?.cat || inferCat(r?.productName));
  const warehouse = normWh(r?.odooWarehouse);
  const productCode = normSku(r?.productCode);
  const sku = productCode && warehouse
    ? buckets.find((b) => b.kind === "sku" && b.productCode === productCode && b.warehouse === warehouse)
    : null;
  if (sku) return { amount: sku.average, source: "sku", sample: sku.sample, type, usage, warehouse };
  const tuw = type && warehouse
    ? buckets.find((b) => b.kind === "typeUsageWh" && b.type === type && b.usage === usage && b.warehouse === warehouse)
    : null;
  if (tuw) return { amount: tuw.average, source: "typeUsageWh", sample: tuw.sample, type, usage, warehouse };
  const tu = type
    ? buckets.find((b) => b.kind === "typeUsage" && b.type === type && b.usage === usage)
    : null;
  if (tu) return { amount: tu.average, source: "typeUsage", sample: tu.sample, type, usage, warehouse };
  const tw = type && warehouse
    ? buckets.find((b) => b.kind === "typeWh" && b.type === type && b.warehouse === warehouse)
    : null;
  if (tw) return { amount: tw.average, source: "typeWh", sample: tw.sample, type, usage, warehouse };
  const t = type ? buckets.find((b) => b.kind === "type" && b.type === type) : null;
  if (t) return { amount: t.average, source: "type", sample: t.sample, type, usage, warehouse };
  if (referential?.effective > 0) return { amount: referential.effective, source: "global", sample: 0, type, usage, warehouse };
  return null;
}

const SOURCE_LABEL = {
  sku: "SKU + plaza",
  typeUsageWh: "tipo · uso · plaza",
  typeUsage: "tipo · uso",
  typeWh: "tipo · plaza",
  type: "tipo",
  global: "promedio general",
};

export function costLabel(r, referential) {
  const kind = originKind(r);
  if (kind === "purchase" && r.odooUnitPrice != null && r.odooUnitPrice !== "") {
    return `USD ${Number(r.odooUnitPrice).toLocaleString("en-US")}`;
  }
  if (kind === "fabrication" && r.moUnitCost != null && Number(r.moUnitCost) > 0) {
    const n = Number(r.moUnitCost);
    return `MO USD ${n.toLocaleString("en-US")}${r.odooSourcePoName ? ` · precursor ${r.odooSourcePoName}` : ""}`;
  }
  if (kind === "adjustment" || kind === "fabrication") {
    const hit = lookupUnitReferential(r, referential);
    const ref = hit?.amount
      ? `Ref. USD ${Number(hit.amount).toLocaleString("en-US")}${SOURCE_LABEL[hit.source] ? ` · ${SOURCE_LABEL[hit.source]}` : ""}`
      : "Referencial";
    if (kind === "fabrication" && r.odooSourcePoName) return `${ref} · precursor ${r.odooSourcePoName}`;
    return ref;
  }
  return "—";
}

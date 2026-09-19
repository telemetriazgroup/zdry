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

export function costLabel(r, referential) {
  const kind = originKind(r);
  if (kind === "purchase" && r.odooUnitPrice != null && r.odooUnitPrice !== "") {
    return `USD ${Number(r.odooUnitPrice).toLocaleString("en-US")}`;
  }
  if (kind === "adjustment" || kind === "fabrication") {
    const ref = referential?.effective ? `Ref. USD ${Number(referential.effective).toLocaleString("en-US")}` : "Referencial";
    if (kind === "fabrication" && r.odooSourcePoName) return `${ref} · precursor ${r.odooSourcePoName}`;
    return ref;
  }
  return "—";
}

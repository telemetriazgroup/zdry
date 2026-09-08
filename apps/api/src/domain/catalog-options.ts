export function normalizeOptionLabel(raw: string) {
  return String(raw || "").trim().replace(/\s+/g, " ");
}

export const DEFAULT_DOCUMENT_CONCEPTS = [
  "Recibo de intercambio de equipo (EIR)",
  "Constancia de conductor",
  "Otro",
];

export const LEGACY_DOCUMENT_CONCEPTS: Record<string, string> = {
  eir: "Recibo de intercambio de equipo (EIR)",
  constancia_conductor: "Constancia de conductor",
  otro: "Otro",
};

export function normalizeDocumentConcept(raw: string) {
  const label = normalizeOptionLabel(raw);
  return LEGACY_DOCUMENT_CONCEPTS[label] || LEGACY_DOCUMENT_CONCEPTS[label.toLowerCase()] || label;
}

export function mergeCatalogOptions(defaults: string[], extras: unknown): string[] {
  const extra = Array.isArray(extras)
    ? extras.map((s) => normalizeOptionLabel(String(s))).filter(Boolean)
    : [];
  const seen = new Set(defaults.map((d) => d.toLowerCase()));
  const out = [...defaults];
  for (const e of extra) {
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

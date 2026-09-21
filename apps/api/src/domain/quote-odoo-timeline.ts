/** Q7: hitos de la SO de esta Quote. No es un poll de Ventas. */

export type TimelineAudience = "staff" | "client";

export type TimelineHit = {
  key: "draft" | "sent" | "sale" | "invoiced" | "out" | "in";
  label: string;
  done: boolean;
  detail?: string;
};

export type TimelineRevisionIn = {
  source: string;
  state?: string | null;
  invoiceStatus?: string | null;
  amountTotal?: number | null;
  diff?: unknown;
  at?: Date | string;
};

export function shouldRecordOdooRevision(origin?: string | null): boolean {
  return String(origin || "odoo").toLowerCase() !== "zdry";
}

export function yardDispatchReady(input: {
  dealStatus?: string | null;
  odooInvoiceName?: string | null;
  odooInvoiceStatus?: string | null;
}): { ok: boolean; reason?: string } {
  if (String(input.dealStatus || "") !== "asignacion_confirmada") {
    return { ok: false, reason: "Confirma el ISO después de validar el pago." };
  }
  const invoiced =
    Boolean(String(input.odooInvoiceName || "").trim()) ||
    String(input.odooInvoiceStatus || "").toLowerCase() === "invoiced";
  if (!invoiced) {
    return { ok: false, reason: "El despacho de patio espera la factura publicada (invoice_posted), no un cambio de precio en Odoo." };
  }
  return { ok: true };
}

export function quoteTimeline(
  input: {
    odooSaleId?: number | null;
    odooSaleName?: string | null;
    odooState?: string | null;
    odooInvoiceName?: string | null;
    odooInvoiceStatus?: string | null;
    odooPickingName?: string | null;
    odooPickingState?: string | null;
    odooPickingInName?: string | null;
    odooPickingInState?: string | null;
    kind?: string | null;
  },
  audience: TimelineAudience = "staff",
): TimelineHit[] {
  const state = String(input.odooState || "").toLowerCase();
  const quoted = Boolean(input.odooSaleId);
  const sent = quoted && (state === "sent" || state === "sale" || state === "done");
  const confirmed = state === "sale" || state === "done";
  const invoiced =
    Boolean(String(input.odooInvoiceName || "").trim()) ||
    String(input.odooInvoiceStatus || "").toLowerCase() === "invoiced";
  const out = String(input.odooPickingState || "").toLowerCase() === "done";
  const inn = String(input.odooPickingInState || "").toLowerCase() === "done";
  const invName = String(input.odooInvoiceName || "").trim();
  const pickName = String(input.odooPickingName || "").trim();
  const inName = String(input.odooPickingInName || "").trim();
  const client = audience === "client";

  const hits: TimelineHit[] = [
    {
      key: "draft",
      label: client ? "Cotización lista" : "Borrador",
      done: quoted,
      detail: quoted ? String(input.odooSaleName || "") : undefined,
    },
    {
      key: "sent",
      label: client ? "Enviada" : "Enviada",
      done: sent,
    },
    {
      key: "sale",
      label: "Confirmada",
      done: confirmed,
    },
    {
      key: "invoiced",
      label: client ? (invName ? `Tu factura ${invName}` : "Facturada") : invName ? `Facturada ${invName}` : "Facturada",
      done: invoiced,
      detail: invName || undefined,
    },
    {
      key: "out",
      label: client
        ? out
          ? `Tu equipo salió${pickName ? ` (${pickName})` : ""}`
          : "Salida"
        : out
          ? `OUT ${pickName || "hecho"}`
          : "OUT",
      done: out,
      detail: pickName || undefined,
    },
  ];
  if (input.kind === "alquiler") {
    hits.push({
      key: "in",
      label: client
        ? inn
          ? `Devolución${inName ? ` (${inName})` : ""}`
          : "Devolución"
        : inn
          ? `IN ${inName || "hecho"}`
          : "IN",
      done: inn,
      detail: inName || undefined,
    });
  }
  return hits;
}

export function revisionDiffSummary(diff: unknown): string {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return "";
  const d = diff as Record<string, { before?: unknown; after?: unknown }>;
  const parts: string[] = [];
  if (d.state && d.state.before !== d.state.after) parts.push(`${d.state.before || "—"} → ${d.state.after || "—"}`);
  if (d.invoiceStatus && d.invoiceStatus.before !== d.invoiceStatus.after) {
    parts.push(`factura ${d.invoiceStatus.before || "—"} → ${d.invoiceStatus.after || "—"}`);
  }
  if (d.amountTotal && d.amountTotal.before !== d.amountTotal.after) {
    parts.push(`total ${d.amountTotal.before} → ${d.amountTotal.after}`);
  }
  if (d.invoiceName && d.invoiceName.before !== d.invoiceName.after) {
    parts.push(`CPE ${d.invoiceName.after || d.invoiceName.before || ""}`.trim());
  }
  if (d.pickingOut && d.pickingOut.before !== d.pickingOut.after) {
    parts.push(`OUT ${d.pickingOut.after || ""}`.trim());
  }
  if (d.pickingIn && d.pickingIn.before !== d.pickingIn.after) {
    parts.push(`IN ${d.pickingIn.after || ""}`.trim());
  }
  return parts.join(" · ");
}

export function followDiffJson(input: {
  snapshot: Record<string, { before: unknown; after: unknown }>;
  beforeInvoice?: string | null;
  afterInvoice?: string | null;
  beforePicking?: string | null;
  afterPicking?: string | null;
  beforePickingIn?: string | null;
  afterPickingIn?: string | null;
}): Record<string, { before: unknown; after: unknown }> {
  const diff = { ...input.snapshot };
  if (String(input.beforeInvoice || "") !== String(input.afterInvoice || "")) {
    diff.invoiceName = { before: input.beforeInvoice || "", after: input.afterInvoice || "" };
  }
  if (String(input.beforePicking || "") !== String(input.afterPicking || "")) {
    diff.pickingOut = { before: input.beforePicking || "", after: input.afterPicking || "" };
  }
  if (String(input.beforePickingIn || "") !== String(input.afterPickingIn || "")) {
    diff.pickingIn = { before: input.beforePickingIn || "", after: input.afterPickingIn || "" };
  }
  return diff;
}

export function followLinesJson(input: {
  event: string;
  payload?: Record<string, unknown> | null;
  invoiceName?: string | null;
  pickingName?: string | null;
}): Record<string, unknown> {
  const p = input.payload || {};
  const out: Record<string, unknown> = { event: input.event };
  if (p.changed != null) out.changed = p.changed;
  if (input.invoiceName) out.invoice = input.invoiceName;
  if (input.pickingName) out.picking = input.pickingName;
  if (p.amount_total != null) out.amountTotal = p.amount_total;
  return out;
}

/** Aplicar eventos J2 a la Quote (semáforo). Anti-eco: origin=zdry no entra. */

export type QuoteFollowPatch = {
  odooState?: string;
  odooInvoiceStatus?: string;
  odooInvoiceName?: string | null;
  odooInvoiceId?: number | null;
  odooPickingName?: string | null;
  odooPickingId?: number | null;
  odooPickingState?: string | null;
  odooPickingInName?: string | null;
  odooPickingInId?: number | null;
  odooPickingInState?: string | null;
  odooAmountUntaxed?: number;
  odooAmountTax?: number;
  odooAmountTotal?: number;
  installment?: {
    odooMoveId: number | null;
    name: string | null;
    amountTotal: number | null;
    invoiceDate: string | null;
    dueDate: string | null;
    paymentState: string | null;
  };
};

export function shouldFollowOdooEvent(origin?: string | null): boolean {
  return String(origin || "odoo").toLowerCase() !== "zdry";
}

export function quotePatchFromOdooEvent(input: {
  event: string;
  model?: string | null;
  resId?: number | null;
  payload?: Record<string, unknown> | null;
}): QuoteFollowPatch | null {
  const ev = String(input.event || "");
  const p = input.payload || {};
  if (ev === "sale_state") {
    const patch: QuoteFollowPatch = {};
    if (p.state != null) patch.odooState = String(p.state);
    if (p.invoice_status != null) patch.odooInvoiceStatus = String(p.invoice_status);
    if (p.amount_untaxed != null) patch.odooAmountUntaxed = Number(p.amount_untaxed);
    if (p.amount_tax != null) patch.odooAmountTax = Number(p.amount_tax);
    if (p.amount_total != null) patch.odooAmountTotal = Number(p.amount_total);
    return Object.keys(patch).length ? patch : null;
  }
  if (ev === "invoice_posted") {
    const name = p.invoice_name != null ? String(p.invoice_name) : null;
    return {
      odooInvoiceStatus: "invoiced",
      odooInvoiceName: name,
      odooInvoiceId: input.resId || null,
      odooState: "sale",
      installment: {
        odooMoveId: input.resId || null,
        name,
        amountTotal: p.amount_total != null ? Number(p.amount_total) : null,
        invoiceDate: p.invoice_date != null ? String(p.invoice_date) : null,
        dueDate: p.invoice_date_due != null ? String(p.invoice_date_due) : null,
        paymentState: p.payment_state != null ? String(p.payment_state) : null,
      },
    };
  }
  if (ev === "picking_out_done") {
    return {
      odooPickingName: p.picking_name != null ? String(p.picking_name) : null,
      odooPickingId: input.resId || null,
      odooPickingState: "done",
    };
  }
  if (ev === "picking_in_done") {
    return {
      odooPickingInName: p.picking_name != null ? String(p.picking_name) : null,
      odooPickingInId: input.resId || null,
      odooPickingInState: "done",
    };
  }
  return null;
}

export function saleIdsFromInvoicePayload(payload?: Record<string, unknown> | null): number[] {
  const p = payload || {};
  const ids = p.so_ids;
  if (Array.isArray(ids)) return ids.map((n) => Number(n)).filter((n) => n > 0);
  return [];
}

export function saleNamesFromPayload(payload?: Record<string, unknown> | null): string[] {
  const p = payload || {};
  const names = p.so_names;
  if (Array.isArray(names)) return names.map((n) => String(n)).filter(Boolean);
  if (typeof p.so_name === "string" && p.so_name) return [p.so_name];
  if (typeof p.origin === "string" && p.origin) return [p.origin];
  return [];
}

export function isosFromPayload(payload?: Record<string, unknown> | null, iso?: string | null): string[] {
  const out: string[] = [];
  if (iso) out.push(iso.trim().toUpperCase());
  const p = payload || {};
  const list = p.isos;
  if (Array.isArray(list)) {
    for (const x of list) {
      const s = String(x || "").trim().toUpperCase();
      if (s) out.push(s);
    }
  }
  if (typeof p.iso === "string" && p.iso.trim()) out.push(p.iso.trim().toUpperCase());
  return [...new Set(out.filter(Boolean))];
}

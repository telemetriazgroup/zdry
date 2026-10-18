import { lineFromOdoo, type DryDealLineDraft } from "./odoo-dry-dossier";

export type SaleUnitPrice = {
  unitPrice: number | null;
  discount: number | null;
  unitNet: number | null;
  invoiceName: string | null;
  invoiceState: string | null;
  invoicePayment: string | null;
  invoiceDate: string | null;
  pickingName: string | null;
};

function compactKey(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function relId(value: unknown) {
  if (Array.isArray(value)) return Number(value[0]) || 0;
  return Number(value) || 0;
}

/** La línea de esta serie dentro del pedido. El total del pedido puede incluir otros equipos. */
export function saleLineForUnit(rawLines: Record<string, unknown>[], iso: string): DryDealLineDraft | null {
  const key = compactKey(iso);
  if (!key) return null;
  const lines = (rawLines || []).map((row) => lineFromOdoo(row)).filter((line) => !line.displayType);
  return (
    lines.find((line) =>
      [line.studioEquipo, line.description, line.lotName, line.productName, line.productCode].some((value) =>
        compactKey(value).includes(key),
      ),
    ) || null
  );
}

/** Neto de la línea. Si Odoo ya trae el subtotal, ese es el precio vendido (el descuento puede ser monto, no porcentaje). */
export function netFromSaleLine(line: Pick<DryDealLineDraft, "priceSubtotal" | "priceUnit" | "discount"> | null): number | null {
  if (!line) return null;
  if (line.priceSubtotal > 0) return Math.round(line.priceSubtotal * 100) / 100;
  if (line.priceUnit > 0) return Math.round(line.priceUnit * (1 - (line.discount || 0) / 100) * 100) / 100;
  return null;
}

export function customerInvoice(raws: Record<string, unknown>[]) {
  const rows = (raws || [])
    .map((row) => ({
      id: Number(row.id) || 0,
      name: String(row.name || "").trim(),
      state: String(row.state || ""),
      payment: String(row.payment_state || ""),
      date: row.invoice_date ? String(row.invoice_date) : null,
      moveType: String(row.move_type || ""),
    }))
    .filter((row) => row.moveType === "out_invoice" && row.state !== "cancel" && row.name && row.name !== "/");
  return rows[0] || null;
}

export function saleUnitFromOrder(input: {
  iso: string;
  order: Record<string, unknown>;
  lines: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  pickingName?: string | null;
}): SaleUnitPrice {
  const orderId = Number(input.order.id) || 0;
  const rawLines = (input.lines || []).filter((line) => relId(line.order_id) === orderId);
  const matched = saleLineForUnit(rawLines, input.iso);
  const invIds = new Set(
    (Array.isArray(input.order.invoice_ids) ? input.order.invoice_ids : []).map((id) => Number(id)).filter((id) => id > 0),
  );
  const invoice = customerInvoice((input.invoices || []).filter((row) => invIds.has(Number(row.id))));
  return {
    unitPrice: matched && matched.priceUnit > 0 ? Math.round(matched.priceUnit * 100) / 100 : null,
    discount: matched ? matched.discount : null,
    unitNet: netFromSaleLine(matched),
    invoiceName: invoice?.name || null,
    invoiceState: invoice?.state || null,
    invoicePayment: invoice?.payment || (input.order.invoice_status ? String(input.order.invoice_status) : null),
    invoiceDate: invoice?.date || null,
    pickingName: input.pickingName || null,
  };
}

/** Día calendario de Lima, ventana inclusiva hacia atrás. */
export function withinLastDays(raw: string | null, now: Date, days: number) {
  if (!raw) return false;
  const day = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const stamp = Date.parse(`${day}T12:00:00-05:00`);
  if (!Number.isFinite(stamp)) return false;
  const end = now.getTime();
  const start = end - days * 24 * 60 * 60 * 1000;
  return stamp >= start && stamp <= end + 12 * 60 * 60 * 1000;
}

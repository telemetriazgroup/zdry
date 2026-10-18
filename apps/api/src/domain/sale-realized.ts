import { lineFromOdoo, type DryDealLineDraft } from "./odoo-dry-dossier";

export type SaleUnitPrice = {
  unitPrice: number | null;
  discount: number | null;
  unitNet: number | null;
  invoiceName: string | null;
  invoiceState: string | null;
  invoicePayment: string | null;
  invoiceDate: string | null;
  invoicePending: boolean;
  pickingName: string | null;
};

function compactKey(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function relId(value: unknown) {
  if (Array.isArray(value)) return Number(value[0]) || 0;
  return Number(value) || 0;
}

function productLines(rawLines: Record<string, unknown>[]) {
  return (rawLines || [])
    .map((row) => lineFromOdoo(row))
    .filter((line) => {
      if (line.displayType) return false;
      if (!(line.priceSubtotal > 0 || line.priceUnit > 0)) return false;
      const blob = `${line.description} ${line.studioTipo} ${line.productName}`.toLowerCase();
      if (/flete|servicio/.test(blob) && !/contenedor|dry/.test(blob)) return false;
      return true;
    });
}

/** La línea de esta serie. Si el pedido no trae el ISO pero todas las líneas valen igual, ese es el precio de la cotización. */
export function saleLineForUnit(rawLines: Record<string, unknown>[], iso: string): DryDealLineDraft | null {
  const lines = productLines(rawLines);
  const key = compactKey(iso);
  const hit = key
    ? lines.find((line) =>
        [line.studioEquipo, line.description, line.lotName, line.productName, line.productCode].some((value) =>
          compactKey(value).includes(key),
        ),
      )
    : null;
  if (hit) return hit;
  if (lines.length === 1) return lines[0];
  const nets = lines.map((line) => netFromSaleLine(line));
  if (lines.length > 1 && nets.every((net) => net != null && net === nets[0])) {
    return lines.find((line) => line.qtyDelivered > 0) || lines[0];
  }
  return null;
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
    invoicePayment: invoice?.payment || null,
    invoiceDate: invoice?.date || null,
    invoicePending: !invoice,
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

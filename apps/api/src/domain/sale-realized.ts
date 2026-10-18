import { lineFromOdoo, type DryDealLineDraft } from "./odoo-dry-dossier";

export type DealKind = "venta" | "alquiler";

export type SaleUnitPrice = {
  unitPrice: number | null;
  discount: number | null;
  unitNet: number | null;
  dealKind: DealKind;
  vendorName: string | null;
  rentEnd: string | null;
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
      const blob = `${line.description} ${line.studioTipo} ${line.productName}`;
      if (/\balquiler\b/i.test(blob)) return false;
      if (/flete|servicio/i.test(blob) && !/contenedor|dry/i.test(blob)) return false;
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

function manyName(value: unknown) {
  if (Array.isArray(value) && value.length > 1) return String(value[1] || "").trim() || null;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function lineBlob(line: DryDealLineDraft) {
  return `${line.description} ${line.studioTipo} ${line.productName}`;
}

function lineHasPrice(line: DryDealLineDraft) {
  return line.priceSubtotal > 0 || line.priceUnit > 0;
}

/** La línea que asigna esta serie, aunque el precio sea 0. */
function equipmentLine(lines: DryDealLineDraft[], iso: string): DryDealLineDraft | null {
  const key = compactKey(iso);
  if (!key) return null;
  const bySerial = lines.find((line) => compactKey(line.studioEquipo).includes(key) || compactKey(line.lotName).includes(key));
  if (bySerial) return bySerial;
  return (
    lines.find((line) =>
      [line.description, line.productName, line.productCode].some((value) => compactKey(value).includes(key)),
    ) || null
  );
}

/**
 * La serie en precio 0 es alquiler: el contenedor vuelve.
 * También lo es una suscripción, un plan recurrente o la palabra alquiler.
 */
export function quotationKind(order: Record<string, unknown>, lines: DryDealLineDraft[], iso?: string): DealKind {
  if (iso) {
    const unit = equipmentLine(lines, iso);
    if (unit && !lineHasPrice(unit)) return "alquiler";
  }
  const plan = order.plan_id;
  const hasPlan = Array.isArray(plan) ? Number(plan[0]) > 0 : Boolean(plan) && plan !== false;
  if (order.is_subscription === true || hasPlan || order.x_studio_leasing === true) return "alquiler";
  const text = [order.x_studio_asunto_cotizacion, order.note, ...lines.map(lineBlob)].join(" ");
  if (/\balquiler\b/i.test(text)) return "alquiler";
  return "venta";
}

/** Cuota del servicio. No es el precio de venta del equipo. */
export function rentFee(lines: DryDealLineDraft[], iso?: string): number | null {
  const named = lines.filter((line) => !line.displayType && /\balquiler\b/i.test(lineBlob(line)) && lineHasPrice(line));
  const unit = iso ? equipmentLine(lines, iso) : null;
  const services =
    named.length || !unit || lineHasPrice(unit)
      ? named
      : lines.filter((line) => line !== unit && !line.displayType && lineHasPrice(line) && !compactKey(line.studioEquipo).includes(compactKey(iso || "")));
  const fees = services.map((line) => netFromSaleLine(line)).filter((net): net is number => net != null && net > 0);
  if (!fees.length) return null;
  return Math.round(fees.reduce((sum, net) => sum + net, 0) * 100) / 100;
}

export type VendorWeekRow = {
  name: string;
  sales: number;
  rents: number;
  gain: number;
  loss: number;
  share: number;
  monthPace: number;
};

/** Actividad de los últimos 7 días. El ritmo mensual repite esa semana cuatro veces. */
export function vendorWeek(
  deals: Array<{ vendor: string | null; kind: DealKind | null; date: string | null; result: number | null }>,
  now: Date,
): VendorWeekRow[] {
  const map = new Map<string, { name: string; sales: number; rents: number; gain: number; loss: number }>();
  for (const deal of deals) {
    if (!deal.kind || !withinLastDays(deal.date, now, 7)) continue;
    const name = deal.vendor || "Sin comercial";
    const row = map.get(name) || { name, sales: 0, rents: 0, gain: 0, loss: 0 };
    if (deal.kind === "alquiler") row.rents += 1;
    else {
      row.sales += 1;
      if ((deal.result || 0) > 0) row.gain += deal.result || 0;
      if ((deal.result || 0) < 0) row.loss += deal.result || 0;
    }
    map.set(name, row);
  }
  const list = [...map.values()].sort((a, b) => b.sales - a.sales || b.rents - a.rents || a.name.localeCompare(b.name));
  const saleTotal = list.reduce((sum, row) => sum + row.sales, 0);
  return list.map((row) => ({
    ...row,
    gain: Math.round(row.gain),
    loss: Math.round(row.loss),
    share: saleTotal ? Math.round((row.sales / saleTotal) * 1000) / 10 : 0,
    monthPace: row.sales * 4,
  }));
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
  const drafts = rawLines.map((row) => lineFromOdoo(row)).filter((line) => !line.displayType);
  const dealKind = quotationKind(input.order, drafts, input.iso);
  const matched = dealKind === "venta" ? saleLineForUnit(rawLines, input.iso) : null;
  const fee = dealKind === "alquiler" ? rentFee(drafts, input.iso) : null;
  const invIds = new Set(
    (Array.isArray(input.order.invoice_ids) ? input.order.invoice_ids : []).map((id) => Number(id)).filter((id) => id > 0),
  );
  const invoice = customerInvoice((input.invoices || []).filter((row) => invIds.has(Number(row.id))));
  return {
    unitPrice: dealKind === "alquiler" ? fee : matched && matched.priceUnit > 0 ? Math.round(matched.priceUnit * 100) / 100 : null,
    discount: matched ? matched.discount : null,
    unitNet: dealKind === "alquiler" ? fee : netFromSaleLine(matched),
    dealKind,
    vendorName: manyName(input.order.user_id),
    rentEnd: input.order.end_date ? String(input.order.end_date).slice(0, 10) : null,
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

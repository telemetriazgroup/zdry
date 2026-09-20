/** Expediente local de una SO DRY: líneas, OUT/IN, facturas y chatter. */

export type DryDocKind = "picking_out" | "picking_in" | "invoice" | "refund" | "other";

export type DryDealLineDraft = {
  odooId: number;
  productCode: string;
  productName: string;
  description: string;
  qty: number;
  qtyDelivered: number;
  qtyInvoiced: number;
  priceUnit: number;
  priceSubtotal: number;
  discount: number;
  tax: string;
  lotName: string;
  studioTipo: string;
  studioEquipo: string;
  displayType: string;
};

export type DryDealDocDraft = {
  kind: DryDocKind;
  odooModel: string;
  odooId: number;
  name: string;
  state: string;
  date: string | null;
  amount: number;
  currency: string;
  paymentState: string;
  isos: string[];
  summary: string;
};

export type DryDealNoteDraft = {
  odooMsgId: number;
  body: string;
  author: string;
  date: string | null;
  messageType: string;
};

export type DryDealHeaderExtra = {
  partnerVat: string;
  paymentTerm: string;
  warehouse: string;
  validityDate: string | null;
  opportunityName: string;
  clientRef: string;
  amountTax: number;
  paymentState: string;
  note: string;
};

export function relName(v: unknown): string {
  if (Array.isArray(v) && v.length > 1) return String(v[1] || "").trim();
  if (v && typeof v === "object" && "name" in v) return String((v as { name?: unknown }).name || "").trim();
  return String(v || "").trim();
}

export function relId(v: unknown): number {
  if (Array.isArray(v) && v.length) return Number(v[0]) || 0;
  if (typeof v === "number") return v;
  return Number(v) || 0;
}

export function stripMailHtml(html: unknown): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function pickingKind(code: unknown): DryDocKind {
  const c = String(code || "").toLowerCase();
  if (c === "outgoing") return "picking_out";
  if (c === "incoming") return "picking_in";
  return "other";
}

export function invoiceKind(moveType: unknown): DryDocKind {
  const t = String(moveType || "").toLowerCase();
  if (t === "out_refund") return "refund";
  if (t === "out_invoice") return "invoice";
  return "other";
}

export function lineFromOdoo(raw: Record<string, unknown>): DryDealLineDraft {
  return {
    odooId: Number(raw.id) || 0,
    productCode: relName(raw.product_id),
    productName: relName(raw.product_id),
    description: String(raw.name || "").trim(),
    qty: Number(raw.product_uom_qty) || 0,
    qtyDelivered: Number(raw.qty_delivered) || 0,
    qtyInvoiced: Number(raw.qty_invoiced) || 0,
    priceUnit: Number(raw.price_unit) || 0,
    priceSubtotal: Number(raw.price_subtotal) || 0,
    discount: Number(raw.discount) || 0,
    tax: Array.isArray(raw.tax_id) ? raw.tax_id.map((t) => relName(t) || String(t)).filter(Boolean).join(", ") : "",
    lotName: relName(raw.lot_id),
    studioTipo: String(raw.x_studio_tipo || "").trim(),
    studioEquipo: String(raw.x_studio_equipo || "").trim(),
    displayType: String(raw.display_type || "").trim(),
  };
}

export function pickingFromOdoo(raw: Record<string, unknown>, isos: string[] = []): DryDealDocDraft {
  const kind = pickingKind(raw.picking_type_code);
  const date = raw.date_done || raw.scheduled_date || null;
  const name = String(raw.name || "");
  return {
    kind,
    odooModel: "stock.picking",
    odooId: Number(raw.id) || 0,
    name,
    state: String(raw.state || ""),
    date: date ? String(date) : null,
    amount: 0,
    currency: "",
    paymentState: "",
    isos,
    summary: [kind === "picking_out" ? "Salida / despacho" : kind === "picking_in" ? "Entrada / retorno" : "Almacén", String(raw.state || ""), isos.join(" ")].filter(Boolean).join(" · "),
  };
}

export function invoiceFromOdoo(raw: Record<string, unknown>): DryDealDocDraft {
  const kind = invoiceKind(raw.move_type);
  return {
    kind,
    odooModel: "account.move",
    odooId: Number(raw.id) || 0,
    name: String(raw.name || ""),
    state: String(raw.state || ""),
    date: raw.invoice_date ? String(raw.invoice_date) : raw.date ? String(raw.date) : null,
    amount: Number(raw.amount_total) || 0,
    currency: relName(raw.currency_id),
    paymentState: String(raw.payment_state || ""),
    isos: [],
    summary: [
      kind === "refund" ? "Nota de crédito" : "Factura",
      String(raw.state || ""),
      String(raw.payment_state || ""),
      raw.invoice_date_due ? `vence ${raw.invoice_date_due}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export function notesFromSaleMessages(rows: Record<string, unknown>[]): DryDealNoteDraft[] {
  const out: DryDealNoteDraft[] = [];
  for (const m of rows || []) {
    const body = stripMailHtml(m.body).slice(0, 6000);
    if (!body) continue;
    out.push({
      odooMsgId: Number(m.id) || 0,
      body,
      author: relName(m.author_id),
      date: m.date ? String(m.date) : null,
      messageType: String(m.message_type || "comment"),
    });
  }
  return out;
}

export function headerExtraFromOdoo(raw: Record<string, unknown>, partnerVat = ""): DryDealHeaderExtra {
  const invoices = Array.isArray(raw._invoices) ? (raw._invoices as Array<{ paymentState?: string }>) : [];
  const pay = invoices.map((i) => i.paymentState).find((s) => s && s !== "not_paid") || invoices[0]?.paymentState || "";
  return {
    partnerVat,
    paymentTerm: relName(raw.payment_term_id),
    warehouse: relName(raw.warehouse_id),
    validityDate: raw.validity_date ? String(raw.validity_date) : null,
    opportunityName: relName(raw.opportunity_id),
    clientRef: String(raw.client_order_ref || "").trim(),
    amountTax: Number(raw.amount_tax) || 0,
    paymentState: pay,
    note: stripMailHtml(raw.note).slice(0, 4000),
  };
}

export function paymentStateFromInvoices(docs: DryDealDocDraft[]): string {
  const inv = docs.filter((d) => d.kind === "invoice" || d.kind === "refund");
  if (!inv.length) return "";
  if (inv.every((d) => d.paymentState === "paid")) return "paid";
  if (inv.some((d) => d.paymentState === "partial")) return "partial";
  if (inv.some((d) => d.paymentState === "in_payment")) return "in_payment";
  return inv[0].paymentState || "";
}

export const DRY_DOSSIER_SO_FIELDS = [
  "id",
  "name",
  "partner_id",
  "note",
  "payment_term_id",
  "warehouse_id",
  "validity_date",
  "opportunity_id",
  "client_order_ref",
  "amount_tax",
  "picking_ids",
  "invoice_ids",
] as const;

export const DRY_DOSSIER_LINE_FIELDS = [
  "id",
  "order_id",
  "product_id",
  "name",
  "product_uom_qty",
  "qty_delivered",
  "qty_invoiced",
  "price_unit",
  "price_subtotal",
  "discount",
  "tax_id",
  "display_type",
  "lot_id",
  "x_studio_tipo",
  "x_studio_equipo",
] as const;

export const DRY_DOSSIER_PICK_FIELDS = [
  "id",
  "name",
  "state",
  "picking_type_code",
  "date_done",
  "scheduled_date",
  "origin",
  "sale_id",
  "location_id",
  "location_dest_id",
] as const;

export const DRY_DOSSIER_INV_FIELDS = [
  "id",
  "name",
  "move_type",
  "state",
  "payment_state",
  "amount_total",
  "amount_residual",
  "invoice_date",
  "invoice_date_due",
  "currency_id",
  "invoice_origin",
] as const;

export const DRY_DOSSIER_MSG_FIELDS = ["id", "res_id", "body", "author_id", "date", "message_type", "attachment_ids"] as const;

export const DRY_FILE_MAX_BYTES = 12 * 1024 * 1024;

export type DryFileKind = "image" | "document";

export type DryDealFileDraft = {
  odooAttId: number;
  name: string;
  mimetype: string;
  size: number;
  kind: DryFileKind;
  source: string;
};

export function classifyDryFile(name: unknown, mime: unknown): DryFileKind | null {
  const n = String(name || "").toLowerCase();
  const m = String(mime || "").toLowerCase();
  if (/image\/(jpeg|jpg|png|webp|gif|bmp)/.test(m) || /\.(jpe?g|png|webp|gif|bmp)$/.test(n)) return "image";
  if (
    /pdf|spreadsheet|excel|msword|officedocument|csv|text\/plain|zip/.test(m) ||
    /\.(pdf|xlsx?|docx?|csv|txt|zip)$/.test(n)
  ) {
    return "document";
  }
  return null;
}

export function fileFromOdoo(raw: Record<string, unknown>, source = "so"): DryDealFileDraft | null {
  const kind = classifyDryFile(raw.name, raw.mimetype);
  if (!kind) return null;
  const size = Number(raw.file_size) || 0;
  const name = String(raw.name || "archivo").trim() || "archivo";
  return {
    odooAttId: Number(raw.id) || 0,
    name: name.slice(0, 240),
    mimetype: String(raw.mimetype || (kind === "image" ? "image/jpeg" : "application/octet-stream")),
    size,
    kind,
    source,
  };
}

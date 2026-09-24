export type OdooDocAccess = "ok" | "name_only" | "pending";

export type OdooDocView = {
  kind: string;
  title: string;
  subtitle: string;
  pending: string | null;
  rows: Array<{ label: string; value: string }>;
  pickings: Array<{ name: string; isos: string[]; date?: string | null }>;
  lines: Array<{ label: string; qty?: string; amount?: string }>;
  components: Array<{ key: string; name: string; qty: string; cost: string; unitCost: string; origin: string; category: string; missing: boolean; editable: boolean }>;
  totals: Array<{ label: string; value: string }>;
  overhead: {
    days: number;
    odooDays: number;
    daysSource: "odoo" | "zdry";
    aguaPerDay: number;
    herramientasPerDay: number;
    adminPerDay: number;
    maquinaria: number;
  } | null;
  isos: string[];
};

function text(v: unknown): string {
  if (v == null || v === false || v === "") return "";
  return String(v).trim();
}

function money(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return `USD ${n.toLocaleString("en-US")}`;
}

function list(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

export function billAccess(data: Record<string, unknown> | null | undefined): OdooDocAccess {
  const raw = String(data?.access || "").toLowerCase();
  if (raw === "ok" || raw === "name_only" || raw === "pending") return raw;
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  if (lines.length) return "ok";
  if (text(data?.name)) return "name_only";
  return "pending";
}

export function presentOdooDocument(input: {
  kind?: string | null;
  name?: string | null;
  summary?: string | null;
  data?: Record<string, unknown> | null;
}): OdooDocView {
  const kind = String(input.kind || "");
  const data = input.data && typeof input.data === "object" && !Array.isArray(input.data) ? input.data : {};
  const title = text(data.name || input.name) || kind || "Documento";
  const pickings = (Array.isArray(data.pickings) ? data.pickings : [])
    .map((p) => {
      const row = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      return { name: text(row.name), isos: list(row.isos), date: text(row.date) || null };
    })
    .filter((p) => p.name);
  const lines = (Array.isArray(data.lines) ? data.lines : [])
    .map((l) => {
      const row = l && typeof l === "object" ? (l as Record<string, unknown>) : {};
      return {
        label: text(row.label || row.name),
        qty: text(row.qty ?? row.quantity) || undefined,
        amount: text(row.amount) || money(row.price) || undefined,
      };
    })
    .filter((l) => l.label);
  const originLabel: Record<string, string> = {
    oc: "OC del lote",
    valuation: "Valoración inventario",
    standard: "Costo promedio",
    move: "Movimiento",
    overhead: "Costo adicional MO",
    zdry: "Ajuste ZDRY",
    missing: "Sin costo en Odoo",
  };
  const components = (Array.isArray(data.components) ? data.components : [])
    .map((c) => {
      const row = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
      const origin = text(row.origin);
      const missing = origin === "missing" || (!row.unitCost && !row.lineCost && origin !== "zdry");
      const name = text(row.name || row.product);
      const key = text(row.key) || name.replace(/^\[([^\]]+)\].*/, "$1").toUpperCase();
      return {
        key,
        name,
        qty: text(row.qty ?? row.quantity) || "—",
        unitCost: money(row.unitCost) || "—",
        cost: text(row.cost) || money(row.lineCost) || "—",
        origin: originLabel[origin] || origin || "—",
        category: text(row.category),
        missing,
        editable: missing || origin === "zdry",
      };
    })
    .filter((c) => c.name)
    .sort((a, b) => Number(b.cost.replace(/[^\d.-]/g, "")) - Number(a.cost.replace(/[^\d.-]/g, "")));
  const isos = list(data.isos);
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: unknown, asMoney = true) => {
    const v = typeof value === "number" ? (asMoney ? money(value) || String(value) : String(value)) : text(value);
    if (v) rows.push({ label, value: v });
  };

  if (kind === "purchase") {
    add("Proveedor", data.partner);
    add("Estado", data.state);
    add("Moneda", data.currency);
    add("Fecha", data.date);
    add("Total", data.amountTotal ?? data.amount_total);
    add("Precio unitario DRY", data.unitPrice ?? data.price_unit);
    add("Cant. recibida", data.qtyReceived ?? data.qty_received, false);
  } else if (kind === "picking_in" || kind === "picking_out" || kind === "transfer" || kind === "repair" || kind === "sale") {
    add("Tipo", data.pickingType || (kind === "picking_in" ? "Entrada" : kind === "picking_out" ? "Salida" : kind === "repair" ? "Reparación" : kind === "sale" ? "Venta" : "Traslado"));
    add("Cliente / destino", data.partner);
    add("Estado", data.state);
    add("Origen (OC/MO)", data.origin);
    add("Fecha", data.date);
    add("Desde", data.locationSrc);
    add("Hacia", data.locationDest);
    add("Total", data.amountTotal ?? data.amount_total);
  } else if (kind === "bill") {
    add("Proveedor", data.partner);
    add("Estado", data.state);
    add("Fecha", data.date);
    add("Total", data.amountTotal ?? data.amount_total);
    add("OC", Array.isArray(data.poNames) ? data.poNames.join(", ") : data.poNames);
  } else if (kind === "mo") {
    add("Producto terminado", data.productFinished || data.product);
    add("Código", data.productCode);
    add("Precursor", data.sourceProduct);
    add("Fecha", data.date);
    add("Costo materiales", data.componentsTotal);
    add("Costos adicionales", data.overheadTotal);
    add("Costo unidad (USD)", data.unitCost ?? data.total);
    add("Moneda compañía Odoo", data.companyCurrency);
    add("Costo completo", data.complete === false ? "No — faltan precios en Odoo" : data.complete === true ? "Sí" : "");
    const oh = data.overhead && typeof data.overhead === "object" ? (data.overhead as Record<string, unknown>) : null;
    if (oh) {
      add(
        "Días de fabricación",
        `${oh.days} (${oh.daysSource === "zdry" ? "ajuste ZDRY" : "referencial Odoo, default 9 — no se calcula de fechas"}${oh.odooDays ? `; Odoo ${oh.odooDays}` : ""})`,
        false,
      );
    }
  } else {
    add("Resumen", input.summary);
  }

  const access = kind === "bill" ? billAccess(data) : "ok";
  const needs = list(data.needs);
  const pending =
    access === "pending"
      ? "Factura Odoo pendiente — sin acceso a account.move"
      : access === "name_only"
        ? `Referencia ${title} — detalle pendiente (sin líneas/PDF)`
        : data.complete === false && kind === "mo"
          ? [
              `Costo de MO incompleto (${Number(data.missingCount) || components.filter((c) => c.missing).length} ítem(s) sin precio). Puedes poner un USD ZDRY en la fila o dejarlo fuera del total.`,
              needs.length ? `En Odoo falta: ${needs.join("; ")}.` : "",
            ].filter(Boolean).join(" ")
          : null;
  const totals: Array<{ label: string; value: string }> = [];
  if (kind === "mo") {
    if (data.componentsTotal != null) totals.push({ label: "Materiales", value: money(data.componentsTotal) || "—" });
    if (data.overheadTotal != null) totals.push({ label: "Adicionales MO", value: money(data.overheadTotal) || "—" });
    if (data.unitCost != null || data.total != null) totals.push({ label: "Costo unidad", value: money(data.unitCost ?? data.total) || "—" });
  }

  return {
    kind,
    title,
    subtitle: text(input.summary) || rows.map((r) => r.value).slice(0, 2).join(" · "),
    pending,
    rows,
    pickings,
    lines,
    components,
    totals,
    overhead: (() => {
      const raw = data.overhead && typeof data.overhead === "object" && !Array.isArray(data.overhead) ? (data.overhead as Record<string, unknown>) : null;
      if (kind !== "mo" || !raw) return null;
      const n = (k: string, fallback = 0) => {
        const v = Number(raw[k]);
        return Number.isFinite(v) ? v : fallback;
      };
      return {
        days: n("days", 9),
        odooDays: n("odooDays", 9),
        daysSource: raw.daysSource === "zdry" ? "zdry" as const : "odoo" as const,
        aguaPerDay: n("aguaPerDay", 4),
        herramientasPerDay: n("herramientasPerDay", 20),
        adminPerDay: n("adminPerDay", 20),
        maquinaria: n("maquinaria", 60),
      };
    })(),
    isos,
  };
}

import { judgeExitDeal, saleMargin } from "./exit-economics";
import { netFromSaleLine, saleLineForUnit, saleUnitFromOrder, vendorWeek, withinLastDays } from "./sale-realized";

const eituLines = [
  {
    id: 1,
    order_id: [10, "10020263840"],
    price_unit: 1790,
    discount: 40,
    price_subtotal: 1750,
    x_studio_equipo: "UACU5385366",
    name: "CONTENEDOR",
    product_uom_qty: 1,
  },
  {
    id: 2,
    order_id: [10, "10020263840"],
    price_unit: 1790,
    discount: 40,
    price_subtotal: 1750,
    x_studio_equipo: "EITU1457417",
    name: "CONTENEDOR DRY 40 HC",
    product_uom_qty: 1,
  },
];

describe("precio de la línea vendida", () => {
  it("toma el neto de EITU1457417 y no el de la otra línea ni el total del pedido", () => {
    const line = saleLineForUnit(eituLines, "EITU1457417");
    expect(line?.studioEquipo).toBe("EITU1457417");
    expect(netFromSaleLine(line)).toBe(1750);
    const file = saleUnitFromOrder({
      iso: "EITU1457417",
      order: { id: 10, name: "10020263840", amount_total: 4130, invoice_ids: [88], invoice_status: "invoiced" },
      lines: eituLines,
      invoices: [{ id: 88, name: "F FF 000263836", state: "posted", payment_state: "paid", invoice_date: "2026-10-01", move_type: "out_invoice" }],
      pickingName: "ZGROU/OUT/08835",
    });
    expect(file.unitNet).toBe(1750);
    expect(file.unitPrice).toBe(1790);
    expect(file.invoiceName).toBe("F FF 000263836");
    expect(file.invoicePayment).toBe("paid");
    expect(file.pickingName).toBe("ZGROU/OUT/08835");
  });

  it("sin factura usa el precio de la cotización y deja la factura pendiente", () => {
    const file = saleUnitFromOrder({
      iso: "CAIU3411377",
      order: { id: 20, name: "10020264184", amount_total: 5250, invoice_ids: [], invoice_status: "to invoice" },
      lines: [
        { id: 1, order_id: [20, "10020264184"], price_unit: 1790, discount: 0, price_subtotal: 1750, qty_delivered: 1, x_studio_equipo: [88, "CAIU341137-7"], name: "CONTENEDOR DRY 40 HC" },
        { id: 2, order_id: [20, "10020264184"], price_unit: 1790, discount: 0, price_subtotal: 1750, qty_delivered: 0, x_studio_equipo: "CAIU844261-6", name: "CONTENEDOR DRY 40 HC" },
        { id: 3, order_id: [20, "10020264184"], price_unit: 1790, discount: 0, price_subtotal: 1750, qty_delivered: 0, x_studio_equipo: "CAIU855646-4", name: "CONTENEDOR DRY 40 HC" },
      ],
      invoices: [],
      pickingName: "ZGROU/OUT/09025",
    });
    expect(file.unitNet).toBe(1750);
    expect(file.unitPrice).toBe(1790);
    expect(file.invoiceName).toBeNull();
    expect(file.invoicePending).toBe(true);
    expect(file.invoicePayment).toBeNull();
  });

  it("si las líneas no traen el ISO pero el precio de cotización es el mismo, usa ese neto", () => {
    const line = saleLineForUnit(
      [
        { id: 1, price_unit: 1790, price_subtotal: 1750, name: "CONTENEDOR DRY 40 HC", product_uom_qty: 1 },
        { id: 2, price_unit: 1790, price_subtotal: 1750, name: "CONTENEDOR DRY 40 HC", product_uom_qty: 1 },
      ],
      "CAIU3411377",
    );
    expect(netFromSaleLine(line)).toBe(1750);
  });

  it("no toma una línea al azar cuando los precios de la cotización son distintos", () => {
    expect(
      saleLineForUnit(
        [
          { id: 1, price_unit: 1000, price_subtotal: 1000, name: "CONTENEDOR" },
          { id: 2, price_unit: 2000, price_subtotal: 2000, name: "CONTENEDOR" },
        ],
        "CAIU3411377",
      ),
    ).toBeNull();
  });

  it("un alquiler no se resta del costo del equipo y guarda al comercial", () => {
    const file = saleUnitFromOrder({
      iso: "CAIU8532296",
      order: {
        id: 31,
        name: "10020264231",
        is_subscription: true,
        plan_id: [4, "Monthly (ZGROUP S.A.)"],
        user_id: [9, "Karla Leandro"],
        x_studio_asunto_cotizacion: "ALQUILER DE CONTENEDOR DRY 40 HC",
        end_date: "2026-12-12",
        invoice_ids: [7],
        invoice_status: "invoiced",
      },
      lines: [
        { id: 1, order_id: [31, "10020264231"], price_unit: 120, price_subtotal: 120, name: "ALQUILER DE CONTENEDOR DRY 40 HC MENSUAL", product_uom_qty: 1 },
        { id: 2, order_id: [31, "10020264231"], price_unit: 0, price_subtotal: 0, name: "ASIGNAR CODIGOS", x_studio_equipo: "CAIU8532296", product_uom_qty: 1, qty_delivered: 1 },
      ],
      invoices: [{ id: 7, name: "F FF1-000008781", state: "posted", payment_state: "paid", invoice_date: "2026-10-14", move_type: "out_invoice" }],
      pickingName: "ZGROU/OUT/08920",
    });
    expect(file.dealKind).toBe("alquiler");
    expect(file.unitNet).toBe(120);
    expect(file.vendorName).toBe("Karla Leandro");
    expect(file.rentEnd).toBe("2026-12-12");
    expect(saleMargin(file.unitNet, 1540, "alquiler")).toBe(120);
    expect(judgeExitDeal({ priceSource: "rule", soldNet: file.unitNet, kind: "alquiler", ruleMin: 1656, ruleList: 1711, inventoryList: null }).verdict).toBe("alquiler");
  });

  it("ordena a los comerciales por ventas de dry de la semana y aparta el alquiler", () => {
    const now = new Date("2026-10-17T20:00:00-05:00");
    const rows = vendorWeek(
      [
        { vendor: "Karla Leandro", kind: "venta", date: "2026-10-15", result: 250 },
        { vendor: "Karla Leandro", kind: "venta", date: "2026-10-16", result: 14 },
        { vendor: "Karla Leandro", kind: "alquiler", date: "2026-10-12", result: 120 },
        { vendor: "Olinda Lopez", kind: "venta", date: "2026-10-14", result: -40 },
        { vendor: "Olinda Lopez", kind: "venta", date: "2026-09-01", result: 800 },
      ],
      now,
    );
    expect(rows.map((row) => row.name)).toEqual(["Karla Leandro", "Olinda Lopez"]);
    expect(rows[0]).toMatchObject({ sales: 2, rents: 1, monthPace: 8 });
    expect(rows[1]).toMatchObject({ sales: 1, rents: 0 });
  });

  it("si no hay subtotal, aplica el descuento como porcentaje", () => {
    expect(netFromSaleLine({ priceSubtotal: 0, priceUnit: 1000, discount: 10 })).toBe(900);
    expect(netFromSaleLine(null)).toBeNull();
  });

  it("cuenta solo los últimos 7 días", () => {
    const now = new Date("2026-10-17T20:00:00-05:00");
    expect(withinLastDays("2026-10-14 11:34:00", now, 7)).toBe(true);
    expect(withinLastDays("2026-09-26 19:04:44", now, 7)).toBe(false);
    expect(withinLastDays(null, now, 7)).toBe(false);
  });
});

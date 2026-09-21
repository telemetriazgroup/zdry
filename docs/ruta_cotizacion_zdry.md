# Ruta: ZDRY emite la cotización (mismo PDF Odoo) para que el cliente pague

Copia operativa. Canónico: `zgroup/documentacion/ruta_cotizacion_zdry.md`.

Sustento: SO `10020263830` · PDF **Perú – Presupuesto/Pedido versión 2**. Report `sale.report_saleorder_copy_1_copy_4`. Alquiler: Pichari `100202616899` (servicio + ISO $0).

**Q0–Q6 hechos.** Venta: SO draft + PDF + pedido + enmienda draft + `sale_close` confirma. Alquiler: `rent_issue` (servicio + ISO $0 + plan) + cuota viva + `rent_close` confirma sin factura de producto. Cronograma = reporte Odoo.

Odoo: puente **17.0.1.5.0** (ACL plan de suscripción + vencimiento/pago en `invoice_posted`).

| Sprint | Odoo código | ZDRY |
|--------|-------------|------|
| Q0 | ACL lectura maestros (en 1.2.0) | Config + probe; Q6: producto alquiler + plan |
| Q1 | `zdry_lookup_sunat` (1.3.0) | Cuenta sin RUC; cotizar con SUNAT (5 / 3 h) |
| Q2 | `quote_issue` (usuario API, draft) | Partner + SO draft, sin confirm |
| Q3 | No (report Studio) | `render_qweb_pdf` + MinIO |
| Q4 | No | voucher atado a `odooSaleName`; no encola `sale_close` |
| Q4b | No | write SO draft; 409 si `sale` (venta) |
| Q5 | ACL 1.4.0 | `sale_close` confirma SO Q2; no valida OUT |
| Q6 | ACL 1.5.0 | `rent_issue` / `rent_close`; cronograma; IN |
| Q7 | Eventos ya en 1.2.0 | `QuoteOdooRevision` (source=odoo en J2 de la Quote) |

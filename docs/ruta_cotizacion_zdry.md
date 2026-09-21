# Ruta: ZDRY emite la cotización (mismo PDF Odoo) para que el cliente pague

Copia operativa. Canónico: `zgroup/documentacion/ruta_cotizacion_zdry.md`. **No implementa J5 ni `sale_close`.**

Sustento: SO `10020263830` · PDF **Perú – Presupuesto/Pedido versión 2**. Report `sale.report_saleorder_copy_1_copy_4`.

**Q0 hecho (21-sep-2026):** `AppSetting` `odoo_quote_issue` + «Leer IDs desde Odoo» en Integración Odoo. Q2 espera `ready: true`.

Odoo: actualizar `zgroup_zdry_bridge` a **17.0.1.2.0** (escucha create/write de SO DRY + `invoice_posted` de factura cliente). El resto de Q se consulta por JSON-2; no se clona el PDF.

| Sprint | Odoo código | ZDRY |
|--------|-------------|------|
| Q0 | ACL lectura maestros (en 1.2.0) | Config + probe |
| Q1 | No | RUC en Customer |
| Q2 | No (create draft, usuario API) | `quote_issue` |
| Q3 | No | `render_qweb_pdf` |
| Q4 | No | voucher |
| Q4b | No | write si draft |
| Q5 | Config picking | `sale_close` confirma |
| Q7 | Eventos ya en 1.2.0 | `QuoteOdooRevision` |

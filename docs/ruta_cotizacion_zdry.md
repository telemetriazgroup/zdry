# Ruta: ZDRY emite la cotización (mismo PDF Odoo) para que el cliente pague

Copia operativa. Canónico: `zgroup/documentacion/ruta_cotizacion_zdry.md`. **No implementa J5 ni `sale_close`.**

Sustento: SO `10020263830` · PDF **Perú – Presupuesto/Pedido versión 2**. Report `sale.report_saleorder_copy_1_copy_4`.

**Q0–Q4 hechos.** Venta: SO draft + PDF Perú v2 + pedido (voucher) en ZDRY. Alquiler no emite SO (Q6). **No implementa Q4b ni J5/`sale_close`.**

Odoo: puente **17.0.1.3.0**. Q3 no pide código Odoo nuevo (`render_qweb_pdf` del reporte Studio).

| Sprint | Odoo código | ZDRY |
|--------|-------------|------|
| Q0 | ACL lectura maestros (en 1.2.0) | Config + probe |
| Q1 | `zdry_lookup_sunat` (1.3.0) | Cuenta sin RUC; cotizar con SUNAT (5 / 3 h) |
| Q2 | `quote_issue` (usuario API, draft) | Partner + SO draft, sin confirm |
| Q3 | No (report Studio) | `render_qweb_pdf` + MinIO |
| Q4 | No | voucher atado a `odooSaleName`; no encola `sale_close` |
| Q4b | No | write si draft |
| Q5 | Config picking | `sale_close` confirma |
| Q7 | Eventos ya en 1.2.0 | `QuoteOdooRevision` |

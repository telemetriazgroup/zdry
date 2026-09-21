# Ruta: ZDRY emite la cotización (mismo PDF Odoo) para que el cliente pague

Copia operativa. Canónico: `zgroup/documentacion/ruta_cotizacion_zdry.md`. **No implementa J5 ni `sale_close`.**

Sustento: SO `10020263830` · PDF **Perú – Presupuesto/Pedido versión 2**. Report `sale.report_saleorder_copy_1_copy_4`.

**Q0 y Q1 hechos.** Puente **17.0.1.3.0** (`zdry_lookup_sunat`). Cuenta sin RUC; cotizar valida SUNAT (5 consultas / 3 h).

Odoo: actualizar `zgroup_zdry_bridge` a **17.0.1.3.0** (`zdry_lookup_sunat`) y `date_sotck_move` a **17.1.1**. El resto de Q se consulta por JSON-2; no se clona el PDF.

| Sprint | Odoo código | ZDRY |
|--------|-------------|------|
| Q0 | ACL lectura maestros (en 1.2.0) | Config + probe |
| Q1 | `zdry_lookup_sunat` (1.3.0) | Cuenta sin RUC; cotizar con SUNAT (5 / 3 h) |
| Q2 | No (create draft, usuario API) | `quote_issue` |
| Q3 | No | `render_qweb_pdf` |
| Q4 | No | voucher |
| Q4b | No | write si draft |
| Q5 | Config picking | `sale_close` confirma |
| Q7 | Eventos ya en 1.2.0 | `QuoteOdooRevision` |

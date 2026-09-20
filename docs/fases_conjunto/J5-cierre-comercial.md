# J5 — Cierre comercial: SO en Odoo y semáforo de vuelta

**Lidera:** ambos. Requiere J1 (costo) y J2 (eventos `sale_state`, `picking_out_done`, `invoice_posted`).

## Objetivo

La oportunidad nace en ZDRY (quote + voucher). La **orden, factura SUNAT y GRE** terminan en Odoo. ZDRY muestra si ya se confirmó, facturó y despachó.

## Trabajo Odoo

1. Usuario API: crear `sale.order` + líneas con `product_id` DRY y `lot_id` (o comando de lote en la línea según setup 17).
2. No auto-validar outgoing al confirmar la SO si eso baja quant mientras el patio ZDRY sigue ocupado.
   - **Decisión de J5:** confirmar SO en `sale` pero dejar picking en espera **o** no crear picking hasta que ZDRY marque salida. Documentar la ruta/almacén elegida en staging.
3. Eventos J2: `sale_state`, `invoice_posted`, `picking_out_done`.
4. GRE (`pe_sunat_guide_override`) solo cuando Almacén Odoo tenga conductor/placa Studio. ZDRY no rellena GRE en esta fase.

## Trabajo ZDRY

1. Worker de `OdooSyncJob` `sale_close` (hoy solo log):
   - Upsert `res.partner` por VAT.
   - Crear SO, guardar `odooSaleId` / `odooSaleName` en `Quote`.
   - Precio congelado de `QuoteLine.priceNet` + extras.
2. Semáforo en la quote: creada / confirmada / facturada / despachada Odoo.
3. Aplicar eventos J2 a ese semáforo.
4. Si Odoo da de baja el quant y ZDRY aún no `markDispatched` → alerta patio (no mover slot solo).
5. `zgroup_stock.vat_required`: exigir RUC en el cliente **antes** de encolar.

## Pruebas

| Tipo | Qué |
|------|-----|
| ZDRY unit | `shouldEnqueueOdoo` solo en `asignacion_confirmada` (ya existe; no romper) |
| ZDRY integración (Odoo test) | Quote cerrada → SO con 1 línea loteada |
| Odoo | Facturar SO → evento `invoice_posted` → ZDRY semáforo facturada |
| Negativo | Cliente sin VAT → job error claro, no SO a medias |
| Regresión | Quote sin asignación no crea SO |
| Staging | Monto SO = monto congelado ZDRY (IGV 18 % half-up) |

## Hecho cuando

- [ ] `enqueueSaleClose` deja de ser un log.
- [ ] Comercial ZDRY ve el nombre de la SO.
- [ ] Al publicar factura en Odoo, ZDRY lo refleja sin “Buscar”.
- [ ] Patio no se vacía solo porque se confirmó la SO.

## Fuera de J5

Pasarela de cobro, alquiler `sale_subscription`, GRE automática desde ZDRY, detracción en el voucher.

Sustento de **venta** (patrón de este worker): SO `100202628772` IMEXCAL, dos DRY 20 DC con precio USD + lote, un OUT, sin IN. Sustento de **alquiler** (fuera de J5): SO `100202616899` Pichari. Proceso: [cotizacion_dry.md](../cotizacion_dry.md). No copiar el patrón de alquiler (servicio + línea a 0 + suscripción) en `sale_close`.

# Cotización DRY en Odoo — alquiler y venta

Copia operativa. Canónico: `zgroup/documentacion/cotizacion_dry.md`. **No implementa J5.**

**Estado**

| Caso | Estado |
|------|--------|
| Alquiler | Documentado. SO `100202616899` / id `529218` · GRUPO PICHARI · servicio + ISO a precio 0 + OUT/IN + cuotas PEN |
| Venta definitiva | Documentado. SO `100202628772` / id `512206` · IMEXCAL · dos DRY 20 DC con precio USD + un OUT · **este es J5** |

## Venta (IMEXCAL) — patrón `sale_close`

- Cliente **IMEXCAL SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA**.
- Asunto **VENTA DE CONTENEDORES DRY 20 DC SEGUNDO USO**. Sin plan recurrente.
- Dos líneas **venta de producto** ~USD 1.420 + IGV 18 % · total **$ 3.339,40**. El lote va **en la misma línea** (no hay asignación a 0).
- Voucher BCP en chatter → confirman SO → factura `F F00-…` publicada → etapa **PERU CERRADO-FACTURADO**.
- Un picking `ZGROU/OUT/06817` (id 140918) con `HLAU351183-4` y `TGHU419562-2`. GRE + fotos camión. Trazabilidad **Existencias → Clientes**. **No hay IN**.
- EIR Studio `x_eir` `2026/001175` y `2026/001176` (SALIDA, precintos). J5 no crea EIR salvo que se pida.

## Alquiler (Pichari) — no es J5

Servicio cobrado + líneas ISO precio 0 + varios OUT + IN de devolución + cuotas. Precio vivo.

## Encaje ZDRY

| Pieza | Hoy | Encaje |
|-------|-----|--------|
| J5 | `enqueueSaleClose` solo log | Reproducir IMEXCAL: partner RUC, SO, líneas priced + `lot_id`, semáforo factura/OUT. **No** suscripción |
| `Quote.kind=venta` | Congela `priceNet` | Ese monto debe ser el de la SO (USD + IGV 18 %) |
| `Quote.kind=alquiler` | Solicitud | Post-J5 / sprint 5 |

Detalle: canónico en el repo Odoo. Ficha: [J5-cierre-comercial.md](fases_conjunto/J5-cierre-comercial.md).

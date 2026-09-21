# Ruta: ZDRY emite la cotización (mismo PDF Odoo) para que el cliente pague

Copia operativa. Canónico: `zgroup/documentacion/ruta_cotizacion_zdry.md`. **No implementa J5 ni `sale_close`.**

Sustento: SO `10020263830` (id 55257) · menú **Perú – Presupuesto/Pedido versión 2**. Report `sale.report_saleorder_copy_1_copy_4` (acción 868).

```
Catálogo ZDRY (ISO publicados; el cliente elige)
  → Q1     RUC + contacto
  → Q2     partner + sale.order draft
  → Q3     PDF Perú v2
  → Q4     voucher = pedido en ZDRY
  → Q4b    descuento / flete / precio  solo si Odoo draft|sent
  → Q5/J5  confirmar + CPE + OUT (venta)
  → Q6     alquiler post-J5
  → Q7     seguimiento + QuoteOdooRevision (diff); si sale → link Odoo
```

## Contrato de edición

| Estado Odoo | ZDRY |
|-------------|------|
| `draft` / `sent` | Puede escribir precio, descuento, extras, ítems; re-PDF |
| `sale` / facturada | Solo lee. CTA: link al form `sale.order`. Comercial trabaja en Odoo |
| `cancel` | Quote perdida |

Facturación y validaciones = Odoo. Despacho de patio y semáforo al cliente = ZDRY.

## Sprints (orden fijo)

| Sprint | Qué | Hecho cuando |
|--------|-----|----------------|
| Q0 | IDs: report, tax 325, pricelist USD, warehouse Callao, mapa 20/40 → product_id | Config que Q2 lee |
| Q1 | Formulario RUC + contacto; bloquear quote sin VAT | Quote nueva siempre con RUC |
| Q2 | Worker `quote_issue`: partner + SO **draft** + Studio; **no** confirmar; **no** lote | SO `10020…` con mismos montos |
| Q3 | `render_qweb_pdf` → MinIO | PDF = Imprimir Perú v2 |
| Q4 | Voucher / pedido sobre esa SO | Bandeja: N° Odoo + PDF + voucher |
| Q4b | Enmienda en borrador; `sale` → 409 + `odooUrl` | Flete/−5 % llega a Odoo y al PDF |
| Q5 | J5 confirma la SO **ya creada** | Checklist [J5](fases_conjunto/J5-cierre-comercial.md) |
| Q6 | Alquiler: servicio + ISO $0 + plan | Post-J5 / sprint 5 |
| Q7 | J2 `sale_state` / `invoice_posted` → `QuoteOdooRevision` | Timeline + link si confirmada |

El PDF de `quote-pdf.ts` es prototipo. No clonar el HTML de Studio.

Detalle de módulos, campos del PDF y riesgos: canónico en el repo Odoo.

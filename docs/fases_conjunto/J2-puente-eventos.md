# J2 — Puente de eventos Odoo → ZDRY

**Lidera:** Odoo (módulo nuevo) + worker ZDRY.

## Objetivo

Enterarse de cambios DRY **sin** `search_read` de todos los modelos cada minuto. ZDRY sabe si el cambio vino de **Odoo** o de **ZDRY**.

## Trabajo Odoo — módulo `zgroup_zdry_bridge`

Crear addon en este repo (no existe hoy):

```
zgroup_zdry_bridge/
  __manifest__.py          depends: stock, purchase, sale, account, date_sotck_move
  models/zdry_sync_event.py
  models/stock_lot.py      create/write DRY → evento
  models/stock_picking.py  incoming/outgoing done + producto DRY
  models/purchase_order.py confirm / qty_received
  models/account_move.py   vendor bill posted ligada a OC DRY
  models/sale_order.py     state / invoice_status (para J5; encolar desde J2)
  security/ir.model.access.csv
  data/ir_config.xml       webhook URL, product domain DRY
```

Modelo `zdry.sync.event`:

| Campo | Uso |
|-------|-----|
| `model`, `res_id`, `iso` | Identidad |
| `event` | `lot_write`, `quant_change`, `picking_in_done`, `picking_out_done`, `po_confirm`, `bill_posted`, `sale_state` |
| `origin` | `odoo` \| `zdry` |
| `payload` | JSON de campos tocados (**sin** binarios) |
| `state` | pending / sent / error |
| `write_date` | Idempotencia `(model, res_id, write_date)` unique |

Reglas:

- Filtrar producto `ilike` contenedor dry (parametrizable).
- Si el `write` trae contexto `zdry_sync=True` → `origin=zdry` y **no** se reenvía a ZDRY (anti-eco).
- Entrega: cron corto que POSTea pending al webhook ZDRY **o** ZDRY hace `search_read` **solo** de esta tabla.
- Usuario API: grupo `zdry_bridge` (lote r/w, event r, OC/factura/SO r).

Tests Odoo (pytest / `TransactionCase`):

- Escribir color en lote DRY crea 1 evento `lot_write`.
- Escribir el mismo lote con `zdry_sync` no crea evento `odoo`.
- Validar IN de producto no-DRY no crea evento.
- Validar IN DRY crea `picking_in_done` con `iso` de las move lines.

## Trabajo ZDRY

1. Endpoint interno `POST /internal/odoo-events` (token) **o** worker que lee `zdry.sync.event`.
2. Aplicar: si campo no `localTouched` → update + `source=odoo`; si difiere → bandeja conciliar.
3. Al write-back, `execute_kw` con `context: { zdry_sync: true }`.
4. Dejar el botón “Buscar en Odoo” como **forzar** (no el camino normal).

## Pruebas

| Tipo | Qué |
|------|-----|
| Odoo unit | Casos de la tabla de arriba |
| ZDRY unit | Aplicar evento vs `localTouched` |
| Integración staging | Cambiar tara en Odoo → aparece en ZDRY con badge Odoo sin pulsar Buscar |
| Integración | Cambiar tara en ZDRY → Odoo cambia y **no** vuelve un segundo evento que pise |
| Carga | 50 writes de lote no-DRY = 0 eventos |

## Hecho cuando

- [ ] Módulo instalable en staging Odoo 17.
- [ ] ZDRY procesa pending < 1 min (cron o webhook).
- [ ] Eco write-back no duplica.
- [ ] Documentado usuario API y `ODOO_ZDRY_WEBHOOK_SECRET`.

## Fuera de J2

Crear SO, subir fotos, clasificar ajuste (eso es J1; J2 solo transporta el evento).

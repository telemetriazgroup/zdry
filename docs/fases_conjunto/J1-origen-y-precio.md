# J1 — Origen (ajuste vs IN) y precio referencial

**Lidera:** ZDRY. **Odoo:** solo lectura nativa (sin módulo nuevo).

## Objetivo

Cada DRY asimilado o reentregado sabe **cómo entró a existencias Odoo** y qué **costo** usar en el marketplace.

## Trabajo Odoo

Ninguno. Usar API existente:

- `stock.move` / `stock.move.line` del lote (trazabilidad).
- `stock.picking` incoming + `purchase_id` / `origin`.
- `purchase.order.line.price_unit`, `account.move` vendor bill.

No crear IN desde ZDRY.

## Trabajo ZDRY

1. En el sync/asimilar, leer trazabilidad del `odooLotId`:
   - Si algún move viene de ubicación *inventory adjustment* / referencia `Inventory Adjustment` → `odooIntakeKind = adjustment`.
   - Si hay picking incoming `done` con `purchase_id` → `odooIntakeKind = purchase`, guardar `odooPickingName`, OC, factura, `odooUnitPrice`.
   - Si no hay moves (solo quant) → `odooIntakeKind = unknown`.
2. Campos nuevos en `Container` / `OdooLotCandidate`: `odooIntakeKind`, `odooPickingName`, `costSource` (`oc` \| `referential` \| `none`).
3. Setting admin `dry_referential_price` (o fórmula: promedio de `odooUnitPrice` de DRY con `costSource=oc` en ventana N meses). Recalcular job opcional.
4. UI bandeja Odoo + ficha: badge **Ajuste** / **OC-…** / **Sin origen**.
5. No poner `intakeType=compra` ni `fobCif` en ajustes.

Casos de prueba de negocio: `APHU678930-9` (ajuste 2023) vs `BMOU433548-9` (IN/06302).

## Pruebas

| Tipo | Qué |
|------|-----|
| Unit | `classifyLotOrigin(moves)` → adjustment / purchase / unknown |
| Unit | Promedio referencial ignora ajustes; usa solo bills/OC DRY |
| API | Asimilar lote de fixture ajuste → `costSource=referential` |
| API | Asimilar lote con IN+OC → `fobCif=1325`, `odooPoName` |
| Staging | Contra APHU y BMOU reales (BD test) |
| Regresión | Write-back y `localTouched` no se rompen |

## Hecho cuando

- [x] La bandeja distingue ajuste vs OC sin pulsar la OC a mano.
- [x] Un ajuste no inventa factura ZDRY (`intakeType=ajuste_odoo`, `fobCif=0`).
- [x] Admin puede ver/editar el referencial (`/config/dry-referential`).
- [x] Specs de `classifyLotOrigin`, referencial y plan de asimilación.

Validación local 19-sep-2026: `APHU678930-9` → ajuste (Inventory adjustment); `BMOU433548-9` → `ZGROU/IN/06302` + OC-0010009472 @ 1325.

Corrección de OC compartida: [j1_correcion.md](j1_correcion.md) (aplicada).  
Extensión pendiente: [j1_fabricacion.md](j1_fabricacion.md) — `LATU901117-1` (MO, mismo serial / dos productos).

## Fuera de J1

Eventos push, conciliación de reentrega, SO, foto única.

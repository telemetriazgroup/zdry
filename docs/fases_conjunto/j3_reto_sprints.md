# J3 reto — Cómo se superan desafíos/riesgos y sprints de implementación

Fecha: 20-sep-2026. Parte de [j3_reto.md](j3_reto.md). Copia canónica también en `zgroup/documentacion/fases/j3_reto_sprints.md`.

---

## 1. Cómo se superan los desafíos técnicos

| # | Desafío | Cómo se supera (diseño concreto) |
|---|---------|----------------------------------|
| 1 | Una OC, varios INs, muchas series | Un `OdooDocSnapshot` por **documento Odoo** (`kind` + `odooId`/`name`), no un JSON suelto por lote. El bloque `purchase.data.pickings[]` lista cada IN done con sus `isos[]`. Cada serie **apunta** al mismo documento (se upserta el snapshot en el ISO de cada lote de esa OC). IN parcial = solo las series de ese picking en `pickings[n].isos`. |
| 2 | Mismo serial, dos `stock.lot` (MO) | El vendible es el lote **a la mano**. El precursor (`odooSourceLotId`) y la MO son expediente de costo. `moCostBreakdown` suma precursor + `move_raw` y guarda el desglose en `kind=mo`. No se crea una segunda unidad vendible. |
| 3 | ACL factura inestable | El bloque `bill` nace con `access: "pending" \| "name_only" \| "ok"`. Sin lectura o solo nombre → badge visible. **No** se crea `PurchaseInvoice` ZDRY. Cuando den Contabilidad al usuario API, el mismo hydrate rellena líneas. |
| 4 | Costeo MO incompleto en Odoo | Fuente: `stock.move` de `raw_material_production_id` (`product_uom_qty` × `price_unit`) + `odooSourceUnitPrice` del precursor. Si falta precio en algún ítem: `complete=false`, se muestra el parcial y **no** se pisa el marketplace con el promedio J1 a escondidas. Si `total>0`, ese total es el `fobCif` de la unidad fabricada. |
| 5 | Progreso real (no spinner eterno) | `AppSetting odoo_assimilate_progress`: `{ status, step, current, total, iso, message }`. El sync escribe el setting en cada fase. UI hace poll `GET /odoo-import/progress`. Un HTTP largo sigue existiendo; la barra refleja **pasos** (quants → orígenes → OC/IN → MO → notas), no un único “cargando”. |
| 6 | No reconsultar Odoo en cada ficha | `getOne` / expediente leen Postgres. Notas Odoo: si ya hay `UnitNote` para el ISO, no hay `search_read`. Fotos/PDF = archivo on-demand (permitido). `refresh=1` o “Traer de Odoo” fuerza API. Hydrate de dossier corre **en el sync**, no al abrir. |

---

## 2. Cómo se mitigan los riesgos

| Riesgo | Mitigación en código |
|--------|----------------------|
| Amarre por “parecido” (tipo/color) | Sigue `proposeMatch`: auto solo ISO normalizado; texto de línea = `proposal`. Ningún score de similitud. |
| Amarre de toda la OC a una reentrega | Confirm usa las series del **picking** del candidato, no todas las de la OC. `pickings[].isos` documenta el recorte. |
| Reentrega pisada por Buscar | Ya: `awaitingReconcile` no vuelca OC/costo. Se mantiene. |
| MO sin costos | `complete=false`; no escribir `fobCif` si total=0. UI: “Costo incompleto”. |
| Factura sin ACL | `access=pending` / `name_only`. No 500. No factura ZDRY automática. |
| Sync masivo tumba Odoo.sh | Hydrate agrupa por `odooPoId` / nombre MO (pocos `search_read`). Fotos: solo metadatos en sync; bytes al ver. |
| Filestore saturado | No se bajan imágenes en el job. J4 aparte. |
| Copia local vieja | Poll J2 45 s + “Traer de Odoo” + re-sync con barra. |

---

## 3. Sprints A–E — implementados 20-sep-2026

Ver tests en `apps/api/src/domain/odoo-doc-present.spec.ts`, `odoo-mo-cost.spec.ts`, `odoo-assimilate-progress.spec.ts`, `odoo-reconcile.spec.ts`.

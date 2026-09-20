# J3 — Conciliar reentrega ZDRY ↔ OC/IN Odoo

**Lidera:** ZDRY. **Odoo:** eventos `picking_in_done` / `po_confirm` de J2.

## Objetivo

Registrar DRY en patio **antes** de que el proveedor mande OC/factura. Cuando el IN exista en Odoo, **proponer y confirmar** el match.

## Trabajo Odoo

Ninguno extra si J2 está verde. El IN `done` ya emite `picking_in_done` + ISOs.

No permitir que ZDRY llame `button_validate` del incoming.

## Trabajo ZDRY

1. Bandeja **Compras → Conciliar**:
   - Izquierda: reentregas `invoicePending` / sin `odooPoId`.
   - Derecha: eventos/candidatos Odoo con `odooIntakeKind=purchase` aún no ligados a container ZDRY, **o** mismo ISO.
2. Match automático **solo** si ISO normalizado igual. Si el serial solo está en el texto de la línea OC → propuesta, no auto.
3. Al confirmar humano:
   - `odooPoId`, `odooPickingName`, `fobCif`, `intakeType=compra`, `costSource=oc`.
   - Deja de usar referencial J1.
4. IN en **borrador** (`ZGROU/IN/07700`) no concilia.
5. IN **parcial**: se concilian solo las series de *ese* IN; la OC puede seguir abierta.

## Pruebas

| Tipo | Qué |
|------|-----|
| Unit | `proposeMatch(reentrega, pickingLines)` por ISO |
| Unit | Texto de línea OC no auto-linkeá |
| API | Confirmar match actualiza container; segundo match del mismo ISO → 409 |
| Staging | Crear reentrega `BMOU433548-9` (si no asimilada) y conciliar con IN/06302 |
| E2E | Coordinador registra reentrega → Compras ve propuesta al llegar evento IN |

## Hecho cuando

- [x] Una reentrega sin papeles existe y no bloquea fotos de campo.
- [x] Al validar el IN en Odoo, Compras ve la propuesta (vía J2 o Buscar).
- [x] Confirmado el match, el marketplace usa 1 325 (ejemplo) no el promedio de ajustes.

Validación local 19-sep-2026: reentrega `BMOU433548-9` → auto ISO `ZGROU/IN/06302` @ 1325; segundo confirm 409. Bandeja: **Compras → Conciliar**.

Ampliación (ficha OC/IN/MO, asimilación de una vez, costo MO, factura pendiente): [j3_reto.md](j3_reto.md).

## Fuera de J3

Crear la OC desde ZDRY. Validar el picking desde ZDRY.

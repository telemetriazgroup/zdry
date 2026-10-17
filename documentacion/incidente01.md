# Incidente 01 — Tracking Piura no entra en la lista aunque el patio dice Almacén Piura

**Fecha:** 2026-10-17  
**Unidad de referencia:** MRKU0118131 (40DC · ASIS · Maersk Line)  
**Dónde se vio:** ficha multimedia del catálogo, con Odoo Producción. Este registro no modificó esa base.

## Síntoma

La ficha muestra patio **Almacén Piura**. En Configuración, el extra **Tracking Piura** está en USD 30, ámbito almacén Odoo Piura, y aplica a OC y referencial. El desglose de la unidad era:

- costo origen USD 500
- Gate Out USD 100
- Agente aduana USD 30
- PSCargo USD 20
- Tracking General USD 70
- margen de seguridad 11 % sobre base USD 799
- venta sugerida USD 888

Tracking Piura no aparecía. Pulsar **Recalcular listas** o **Recalcular por reglas** repetía el mismo desglose.

En el expediente Odoo de la misma unidad sí está el movimiento:

- entrada ZGROU/IN/07814 hacia ZGROU/Existencias
- traslado **ZGROU/INT/00169**, hecho el 2026-10-14, desde ZGROU/Existencias hacia **Piura/Existencias**

Agente aduana USD 30 y PSCargo USD 20 existen para Piura y para ZGROU/Callao con el mismo monto, así que no demuestran qué plaza se usó. Tracking Piura solo existe para la plaza PIURA. Su ausencia indica que el cálculo no estaba usando esa plaza.

## Causa

Hay dos datos distintos y el precio usa solo uno:

| Dato | Qué responde | Campo |
|------|----------------|--------|
| Patio ZDRY | Dónde está la unidad para despacho (Almacén Piura, Principal, Gambeta) | `depot` |
| Plaza Odoo | Qué extras de almacén entran en la base | `odooWarehouse` (`PIURA` o `ZGROU`) |

El extra hace match exacto: `odooWarehouse` en mayúsculas tiene que ser igual al destino del concepto (`PIURA`). El rótulo “Almacén Piura” es el patio, no ese código.

Al asimilar, la plaza se copia de la ubicación del lote en ese momento. El relleno posterior (`fillEmptyFromOdoo`) solo escribía `odooLocation` y `odooWarehouse` si estaban vacíos. Un traslado posterior —el quant pasa a Piura/Existencias— actualizaba el expediente en vivo, y el patio podía quedar en Almacén Piura, pero la plaza de costo seguía en `ZGROU`.

**Recalcular listas** solo volvía a aplicar la fórmula sobre la plaza ya guardada. No leía la ubicación actual en Odoo, así que Tracking Piura nunca coincidía.

## Cambio

1. **Traslado.** Si la ubicación interna actual del lote cambia de plaza, se actualizan `odooLocation` y `odooWarehouse`. Piura mueve el patio a Almacén Piura. Salir de Piura hacia ZGROU deja el patio en Callao por asignar, para que despacho elija Principal o Gambeta. Un movimiento dentro de ZGROU no pisa el patio fino. Queda un evento **Traslado Odoo** y se recalculan las listas que no son oferta a mano.
2. **Ficha del catálogo.** Cada 2 minutos, mientras la ficha está abierta, se leen las ubicaciones de las unidades de esa lista. Si alguna plaza cambió, se recalcula. **Recalcular listas** hace esa lectura antes de recalcular. La ficha muestra patio y plaza de costo por separado, y avisa si el patio es Piura pero la plaza de costo no es PIURA.
3. **Tipo al asimilar.** Si el producto de Odoo nombra un código que existe en los maestros (`40 DC` → `40DC`, `20 DC` → `20DC`, `40 HC` → `40HC`), ese tipo se toma solo. No se sustituye `40DC` por `40GP`. Si no hay esa concordancia, la asimilación se detiene y el encargado de despacho tiene que elegir el tipo exacto en la ficha. Una elección guardada por despacho prevalece sobre la sugerencia.

La vigilancia de lotes nuevos (cada 5 minutos) no se activó con este cambio. La lectura de plaza es solo de unidades que ya están en la ficha.

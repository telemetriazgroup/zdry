# J1 corrección — `ZCSU401278-2` muestra IN y no la OC

Copia operativa. Canónica en Odoo: `zgroup/documentacion/fases/j1_correcion.md`.

Fecha: 19-sep-2026. Caso visto en bandeja local ZDRY vs Odoo staging.

## Qué se ve

| Superficie | Dato |
|------------|------|
| Odoo lote | `ZCSU401278-2`, `[CDE40H0027] CONTENEDOR DRY 40 OT SEGUNDO USO`, ZGROU/Existencias |
| Odoo compras | **OC-0010007645** · ECONTAINERS GLOBAL LLC · 4 ud × **USD 1 500** · total 6 000 · totalmente facturado |
| Odoo recepción | **ZGROU/IN/04689** (incoming `done`) · origen OC-0010007645 · `purchase_id` y `purchase_line_id` presentes |
| ZDRY bandeja | Origen badge **ZGROU/IN/04689**, costo **—**, sin OC |
| ZDRY ficha | `odooIntakeKind=purchase`, fuente “OC / factura”, albarán IN/04689, bloque Compras vacío |

El IN en pantalla **no es un error de origen**: el lote sí entró por esa recepción. El fallo es que ZDRY **no guardó la OC ni el precio**, y la UI usa el IN como etiqueta cuando falta `odooPoName`.

## Qué hay en Odoo (lectura real, lote 21538)

`stock.move` 100635 (`done`):

- `origin` = `OC-0010007645`
- `reference` = `ZGROU/IN/04689`
- `purchase_line_id` = **18760** (`CDE40H0027`, `price_unit` 1500)
- `picking_id.purchase_id` = OC-0010007645

Ese **mismo** `stock.move` tiene **tres** `stock.move.line` (un move, varios seriales):

| lot_id | Serial |
|--------|--------|
| 21537 | `ZCSU402720-5` |
| 21538 | `ZCSU401278-2` |
| 21539 | `ZCSU401690-0` |

La OC tiene dos líneas:

1. Producto 18760 — 4 ud, USD 1500 (costo real).
2. Nota 18761 — precio 0, seriales en texto **con saltos de línea, sin `//`**:

```
JXLU402859-9
ZCSU402720-5
ZCSU401690-0
ZCSU401278-2
```

En ZDRY, de los tres lotes del IN, **solo `ZCSU401690-0`** tiene `odooPoName=OC-0010007645` y precio 1500. Los otros dos quedaron `purchase` + IN y sin OC.

## Causa (dos huecos en el sync J1)

### 1. Un `stock.move` → un solo lote (bug principal)

`resolvePurchaseRefs` (`odoo-import.service.ts`) arma un mapa **move → lote**:

```ts
moveToLot.set(mid, lid); // el último pisa a los anteriores
```

Luego recorre **moves** (no líneas) y escribe la OC en **un** `odooLotId`.  
Odoo 17 recibe N seriales DRY en **un** move de la línea de producto. Gana un lote; el resto del mismo IN queda sin OC/precio.

Eso no es un caso aislado. Tras el sync J1 (bandeja a la mano):

- **55** lotes `odooIntakeKind=purchase` **sin** `odooPoName` / sin precio.
- Varios IN partidos: p. ej. `IN/05666` 1 con OC y 14 sin; `IN/04689` 1 con OC y 2 sin.

`attachIntakeOrigins` sí ve `picking.purchase_id` y marca `purchase` + `odooPickingName`. **No copia** `purchaseName` a `odooPoName`. Por eso la ficha dice “es compra” pero Compras está vacía.

### 2. Fallback por texto de la OC exige `//`

El segundo camino busca `purchase.order.line` con `name ilike "//"` (estilo `CAIU… // CAIU…`).  
Esta OC lista seriales con `\n`. `ZCSU401278-2` está en el texto y `parseSerialsFromPoText` lo extraería, pero **nunca se lee esa línea**.

Además el serial vive en la **línea nota** (precio 0). El precio hay que tomarlo de la línea de producto de la misma OC, no de la nota.

## Por qué la UI muestra el IN

```js
// apps/web/src/odoo-origin.js
label: r.odooPoName || r.odooPickingName || "OC"
```

Sin `odooPoName` el badge es el albarán. El costo queda "—" porque `odooUnitPrice` es null (aunque `costSource=oc`).

## Qué no es

- No falta la OC en Odoo.
- No es un ajuste de inventario.
- J1 no debe crear IN ni validar recepciones.
- El IN/04699 que se lee en captura de bandeja es el mismo albarán: en BD es **ZGROU/IN/04689**.

## Corrección a implementar (ZDRY, sin módulo Odoo)

1. **Mapear por `stock.move.line`**, no por move: cada `lot_id` del move con `purchase_line_id` hereda OC, proveedor, factura y `price_unit` de esa línea.
2. Si el move no trae `purchase_line_id` pero el picking tiene `purchase_id`, resolver la OC por el picking (origen nativo Odoo).
3. Ampliar el match por texto: serial en `name` de la línea (nueva línea o `ilike` del ISO), no solo `//`. Precio desde la línea de producto de esa OC (`price_unit > 0`).
4. En `attachIntakeOrigins`, si `origin.purchaseName` existe y el candidato no tiene `odooPoName`, persistirlo (no dejar solo el IN).
5. Badge: si hay OC, **siempre** mostrar `OC-…`; el IN queda como albarán en la ficha.
6. Tests: fixture de **un** move + **tres** lotes (este caso). Los tres deben salir con `OC-0010007645` y 1500. Texto con `\n` sin `//` también debe matchear.
7. Re-sync local y verificar `ZCSU401278-2`, `ZCSU402720-5` y `ZCSU401690-0`.

## Hecho cuando (esta corrección)

- [x] `ZCSU401278-2` en bandeja: origen **OC-0010007645**, costo **USD 1 500**, albarán IN/04689 en ficha. Misma OC en `ZCSU402720-5` y `ZCSU401690-0`. Factura Odoo **C 3107**.
- [x] Los 55 `purchase` sin OC bajaron a **0** (189 con OC) tras “Buscar en Odoo”.
- [x] Spec del move compartido + spec texto con saltos de línea.
- [x] Un ajuste sigue sin inventar factura (`classifyLotOrigin` / `assimilateCostPlan` sin cambio).

Aplicado 19-sep-2026 en ZDRY: `assignRefsBySharedMove` + notas OC (`display_type=line_note` o `//`).

No entra aquí: J2 eventos, conciliar reentrega, SO.

# Implicancias de integrar contenedores DRY desde Odoo hacia ZDRY

Documento de evaluación. No implementa el conector: fija alcance, módulos Odoo, mapeo, riesgos y la secuencia de trabajo para que Almacén pueda contar y regularizar unidades ya existentes en Odoo.

Fuente de negocio: `caso_aplicacion.md`. Contrato vigente del producto: `proyecto_zdry.md` §1.5. Pantallas de referencia: Inventario → Números de serie/lote (`stock.lot`), ficha del lote (ej. `INKU252806-7`), Orden de compra (`purchase.order`, ej. `OC-0010009472`) en el Odoo de pruebas de ZGROUP S.A.C.

---

## 1. Qué se pide (y qué no)

**Objetivo.** Traer a ZDRY los DRY que Odoo ya tiene *a la mano*, con su serial y las características que existan, para:

1. Contarlos y regularizarlos en **Recepción → pendientes**.
2. Completar fotos e inspección en patio.
3. Publicar en el catálogo solo cuando un comercial/admin apruebe media.
4. Más adelante, enlazar la factura / orden de compra de origen (deuda explícita).

**Reglas de negocio pedidas.**

| Regla | Implicancia en ZDRY |
|---|---|
| El único dato bloqueante para crear la unidad es el **código de serie** | El intake de integración no puede exigir tipo, condición, depósito “correcto”, DAM, factura ni fotos. |
| Asimilar **uno a uno** (o por lote elegido), no un dump periódico de todo Odoo | Sync por diferencia (`write_date` / hash), con cola de “candidatos” y acción humana “asimarse”. |
| Muchos aún no tienen foto | Quedan `mediaStatus = pendiente` y **no** salen al catálogo público. |
| Fotos de Odoo (notas / chatter) son un extra | Se importan como historial o borrador; no sustituyen las 9 casillas de inspección. |
| Evaluación piso / techo / puertas / pintura | Campo **administrativo**. Nunca viaja al catálogo público. Sirve para criterio de precio. |
| Marca de agua al publicar | Se aplica en el momento de **aprobar** para la web, no al guardar la foto cruda de Almacén. |
| Facturas y OC “en deuda” | Se guardan referencias (`odooLotId`, `odooPoName`, DUA) sin crear aún `PurchaseInvoice` completa. |

**Qué no se pide ahora.** Empujar ventas ZDRY → Odoo (eso ya está esbozado en el cierre comercial). Hablar con SUNAT. Mover el patio desde Odoo. Recargar todo el inventario cada noche.

---

## 2. Estado actual de ZDRY (punto de partida)

Hoy la flecha es **ZDRY → Odoo**, y solo en el cierre de venta:

- Superadmin configura `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY` (pantalla Integración Odoo).
- `OdooClient` encola el evento de cierre; **no lee** `stock.lot` ni `purchase.order`.
- El plan de producto dice: *Odoo no manda sobre el patio*. Un cambio de factura en Odoo no mueve un contenedor.

El ingreso operativo hoy es **manual** en Recepción:

- Alta exige ISO 6346 válido (3 letras + `U` + 6 dígitos + dígito de control).
- El parser ya quita espacios y **guiones** (`INKU252806-7` → `INKU2528067`).
- Si el dígito de control no cierra, **bloquea** (salvo flujo de excepción ISO en Compras).
- Tipo y condición son obligatorios en el intake actual.
- La unidad nace `Pendiente de ingreso`, `physicallyReceived = false`, `mediaStatus = pendiente`.
- El catálogo público solo lista `mediaStatus = aprobado` y al menos una foto activa.

Eso choca con “solo el código es bloqueante”. La integración necesita un **intake de origen Odoo** distinto del formulario de patio, que cree la fila mínima y deje el resto para regularizar.

En un proyecto anterior ya se consultó **Contactos** (`res.partner`) con las mismas credenciales. Eso se reutiliza para el proveedor de la OC (`ECONTAINERS GLOBAL LLC`) cuando se cierre la deuda de compras.

---

## 3. Módulos Odoo involucrados

El hilo de las pantallas no es un solo modelo. Es una cadena Inventario → Compras → Facturación, con fotos en el chatter.

```
stock.lot (serie / lote = 1 contenedor)
    ├─ product.product / product.template   (tipo 20/40, nuevo vs 2º uso)
    ├─ product.category                     (Contenedor Dry)
    ├─ stock.quant                          (cantidad a la mano, ubicación)
    ├─ stock.location                       (ZGROU/Existencias, Principal Callao: Recepciones)
    ├─ mail.message + ir.attachment         (fotos y notas en el chatter)
    ├─ stock.picking / stock.move           (recepciones; la OC muestra “Recepción (3)”)
    ├─ purchase.order + purchase.order.line (OC-0010009472; 21 unidades, seriales en texto)
    └─ account.move                         (factura proveedor; “Totalmente facturado”)
```

### 3.1 Inventario — `stock.lot` (núcleo)

Es la **fuente de verdad de la unidad**. Filtro de negocio: producto contiene “contenedor dry” + estado **A la mano**.

Campos vistos en ficha (mapeo a ZDRY):

| Odoo (ficha lote) | ZDRY hoy | Notas |
|---|---|---|
| Número de serie/lote `INKU252806-7` | `Container.iso` | Normalizar: mayúsculas, quitar `-`. Validar ISO 6346; si falla, crear con `isoException` + motivo “origen Odoo”. |
| Producto `[CDD40H0004] CONTENEDOR DRY 40 HC SEGUNDO US` | `type` + `cat` | Traducir código interno Odoo → `40HC` / `20GP`. “Segundo uso” → `CW`/`WWT`/`ASIS` queda **pendiente de regularizar** (no adivinar). |
| Categoría “Contenedor Dry” | filtro de sync | Ignorar otros productos (reefer, office, etc.) salvo que se pida después. |
| Cantidad a la mano 1.00 | existencia | Un lote = una unidad. Si qty ≠ 1, marcar anomalía y no asimilar a ciegas. |
| Color AZUL | `color` | Mapear a la lista ZDRY (Azul, …) o dejar el texto y regularizar. |
| Peso (Kg) 26 590 | `mgwKg` (candidato) | Confirmar si Odoo guarda MGW o peso bruto; no mezclar con tara. |
| Tara 3 890 | `tareKg` | Encaja directo. |
| Procedencia CHINA | nuevo o `inspectionNotes` | No hay campo “origen” en schema. |
| Tipo material ACERO | notas / maestro | No bloquea. |
| N° DUA `118-2026-10-356526-01-2-00` | `damNumber` | **Formato distinto** al DAM ZDRY (`118-2026-40-81593`). No validar con `DAM_REGEX` al importar; guardar crudo en `damNumber` o `odooDua` y regularizar en Compras. |
| Año / mes / fabricante | `year`, `manufacturer` | En la ficha de ejemplo vienen vacíos; en el listado a veces sí (CIMC 2007). Sync solo si hay valor. |
| Ubicación `ZGROU/Existencias` | `depotId` | Mapear ubicación Odoo → depósito ZDRY (Callao, etc.). Si no hay mapa, usar depósito por defecto y dejar “ubicación Odoo” para regularizar. **No asignar lado/ruma/columna.** |
| Empresa ZGROUP S.A.C. | filtro compañía | Multi-compañía: solo lotes de la empresa operativa. |
| Código / Código ZGroup | alias | Suele repetir el serial. Guardar si diverge. |

**Implicancia.** El listado “A la mano” es el universo de conteo. ZDRY no debe importar lotes vendidos, en tránsito de salida o qty 0, salvo un modo “histórico” que no se pide.

### 3.2 Inventario — `stock.quant` y ubicaciones

“A la mano” no vive en el lote: vive en `stock.quant` (lote + ubicación + cantidad).

- Una misma serie no debería estar en dos ubicaciones; si lo está, es dato sucio y se reporta, no se parte la unidad.
- `Principal Callao: Recepciones` vs `ZGROU/Existencias` indica **etapa**, no patio ZDRY. Recibido en Odoo ≠ inspeccionado en ZDRY. Por eso la unidad asimilada entra a **pendientes de recepción**, no al layout.

### 3.3 Inventario — recepciones (`stock.picking`)

La OC muestra **Recepción (3)**. Sirve para saber si el lote ya cruzó la puerta en Odoo. No se usa para posicionar en patio. Si más adelante se quiere “Gate-In automático”, sería un plus; el caso pide regularizar en ZDRY, no fiarse del picking.

### 3.4 Compras — `purchase.order` (deuda, no bloqueante)

Camino: ficha lote → Compras → `OC-0010009472`.

Hallazgos de las pantallas:

- Una OC de 21 unidades del mismo producto (`[CDD40HC004] … 40 HC SEGUNDO USO`), total USD 27 825, **totalmente facturada**.
- Los 21 seriales aparecen como **texto libre** en la línea (`CAIU822565-9 // CAIU830527-1 // …`), no necesariamente como 21 `stock.lot` ligados por ORM.
- Proveedor `ECONTAINERS GLOBAL LLC`, comprador interno, entrega a *Principal Callao: Recepciones*.
- Precio unitario 1 325 USD = FOB/CIF candidato para `fobCif` cuando se enlace.

**Implicancia.** No se puede asumir que “abrir Compras desde el lote” sea una FK limpia. Hay que resolver:

1. `stock.lot` → movimientos → `purchase.order` (camino nativo), **o**
2. parsear el bloque de seriales de la línea (frágil), **o**
3. dejar `odooPoName` vacío y que Compras lo pegue después.

Hasta que exista `PurchaseInvoice` en ZDRY, la unidad entra como `intakeType = pendiente_factura` (ya existe) e `invoicePending = true`. Eso coincide con “factura en deuda”.

Cargar las 21 líneas de golpe **sin** asimilar cada serie duplicaría stock. La OC se importa como **documento padre**; las unidades solo nacen al asimilar el lote.

### 3.5 Contabilidad — factura proveedor (`account.move`)

“Totalmente facturado” es el cierre financiero en Odoo. En ZDRY la factura de compra es otro módulo (número, Incoterm, BL, manifiesto, DAM). **No se porta en esta fase.** Se guarda el id/nombre de la factura Odoo como referencia. Relacionar ISO ↔ factura es el paso 2 de Compras.

### 3.6 Chatter / Correo — fotos (`mail.message`, `ir.attachment`)

Las 8 fotos de la ficha `INKU252806-7` están en **notas del chatter** (31/07/2026), no en un campo imagen del lote ni en las 9 casillas ZDRY.

**Implicancia.**

- Consumir adjuntos de `ir.attachment` ligados al `stock.lot`.
- Guardarlos en MinIO como `odoo/{iso}/inbox/{n}` (historial), **no** como foto activa de slot.
- Almacén elige después qué inbox va a cada casilla (o vuelve a fotografiar).
- Publicar sigue exigiendo ≥1 foto **activa** + aprobación. Las fotos de Odoo no publican solas.

Volumen: un lote con 8–20 JPEG. El sync incremental no debe re-bajar binarios si el `checksum` / `write_date` del adjunto no cambió.

### 3.7 Contactos — `res.partner` (ya probado)

Sirve para el proveedor de la OC y, si aplica, el partner de la ubicación. No se usa para crear clientes de venta. Reutilizar el conector que ya funcionó.

### 3.8 Productos y marcas

`product.product` trae el código `[CDD40HC004]` y el nombre largo. Hace falta una **tabla de equivalencias** (configurable por superadmin):

- `CDD40HC*` / “40 HC” → `40HC`
- “20 DC” / “20 GP” → `20GP`
- “SEGUNDO USO” / “NUEVO” / “1-TRIP” → sugerencia de `cat`, editable en regularización

Sin tabla, se crea con tipo/condición **placeholder** (`40HC` + `ASIS` o “por clasificar”) porque no son bloqueantes. El placeholder debe ser visible en Recepción (badge “origen Odoo — regularizar”).

---

## 4. Choques de reglas (lo que rompe si se ignora)

### 4.1 ISO 6346 vs serial Odoo

Odoo muestra `INKU252806-7`. ZDRY guarda `INKU2528067`. El parser ya tolera el guion.

Riesgo: lotes mal tipeados, dígito de control incorrecto, o 4ª letra ≠ `U`. El intake actual **rechaza**. El caso dice que solo el código bloquea: hay que crear con `isoException = true` y no impedir el conteo. Patio y catálogo pueden seguir; Compras ve la excepción.

### 4.2 DAM ZDRY vs DUA Odoo

`DAM_REGEX` = `118-2026-40-81593`. El DUA de la ficha es más largo (`…-356526-01-2-00`). Si se pasa por el validador actual, **nunca** nacionaliza. Guardar DUA crudo; la nacionalización formal se hace en Compras cuando el formato ZDRY exista o se amplíe el validador.

### 4.3 “A la mano” en Odoo ≠ listo para vender en ZDRY

Odoo ya lo cuenta en existencias. ZDRY lo cuenta en **pendientes** hasta inspección, fotos y (si aplica) aprobación web. Dos inventarios coexisten: no se pisa el quant de Odoo. ZDRY no escribe `stock.quant` en esta fase.

### 4.4 Patio

Sigue valiendo: *Odoo no manda sobre el patio*. La integración **no** asigna lado/ruma/nivel. Almacén ubica cuando reciba físicamente.

### 4.5 Catálogo público

Unidad asimilada ≠ publicada. Condición administrativa (piso/techo/puertas/pintura) **no** se expone. Precio sigue las reglas de visibilidad actuales.

### 4.6 Saturar Odoo

Prohibido un cron que relea todos los lotes + todos los adjuntos. Contrato de sync:

1. Primera pasada: listar ids + `write_date` de lotes DRY a la mano (campos livianos, sin binarios).
2. Guardar `odooLotId`, `odooWriteDate`, `assimilatedAt`.
3. Siguientes pasadas: solo ids con `write_date` mayor, o lotes nuevos.
4. Binarios: por `checksum` de `ir.attachment`.
5. Asimilar a `containers` es un POST explícito (uno o selección), no el listado.

### 4.7 Dirección del dato

| Flujo | Fase |
|---|---|
| Odoo → ZDRY (lotes DRY a la mano) | Esta integración |
| ZDRY → Odoo (cierre de venta) | Ya previsto; no mezclar colas |
| Odoo → ZDRY (OC / factura) | Fase 2 Compras |
| ZDRY → Odoo (movimientos de patio) | Fuera de alcance |

Si alguien corrige color en Odoo después de asimilar: se muestra el delta en “regularizar”; **no** se pisa el campo que Almacén ya editó, salvo que el campo ZDRY siga vacío.

---

## 5. Modelo mental en ZDRY (tres bandejas)

```
Odoo (a la mano)
    → Bandeja Integración (candidatos, aún no son Container)
        → Asimilar (solo ISO obligatorio)
            → Recepción / pendientes  (conteo + fotos + evaluación admin)
                → Patio (posición)
                → Ficha catálogo (aprobación + marca de agua)
                → Web pública
        → (después) Compras: OC + factura + DAM
```

**Bandeja Integración** (superadmin + almacén + compras, por definir):

- Serial Odoo, producto, ubicación, DUA, OC si se resolvió, “¿ya en ZDRY?”.
- Acciones: Asimilar / Ignorar (no es DRY de venta) / Ver delta.

**Recepción pendientes** (ya existe): cada asimilado aparece como hoy, con badge `Origen Odoo` y huecos (fotos, tipo, condición comercial, evaluación piso/techo/puertas/pintura).

---

## 6. Campos nuevos que el caso exige (aún no existen)

| Campo | Quién lo ve | Uso |
|---|---|---|
| `odooLotId`, `odooWriteDate`, `odooLocation` | staff | Idempotencia y delta |
| `odooPoName` / `odooPoId`, `odooVendorName` | Compras | Deuda OC |
| `odooDua` (si no cabe en `damNumber`) | Compras | DUA crudo |
| `originCountry` | staff | Procedencia |
| `conditionFloor`, `conditionRoof`, `conditionDoors`, `conditionPaint` (`bueno` \| `regular` \| `malo`) | admin / gerente / almacén | Criterio de precio; **nunca** API catálogo |
| `intakeOrigin = odoo` | staff | Distinguir del alta manual |
| Setting `catalog_watermark` (archivo MinIO) | superadmin / config | Se aplica al **publicar**, sobre copias de salida, no sobre el original de inspección |

La marca de agua no debe destruir el archivo de Almacén: se genera un derivado `public/` al aprobar.

---

## 7. Pasos a realizar (secuencia)

### Fase 0 — Contrato y acceso (sin tocar patio)

1. Superadmin carga credenciales reales (las mismas del `.env` que ya leyó Contactos) y prueba `version` + `res.partner` (humo).
2. Confirmar compañía (`ZGROUP S.A.C.`), criterio de producto (“contenedor dry”) y mapa **ubicación Odoo → depósito ZDRY**.
3. Confirmar ambiente: el de las capturas es **test** (`dev.odoo.com`, BD neutralizada). Producción es otra URL/BD; no mezclar lotes de prueba con patio real.
4. Ampliar `OdooClient`: JSON-2 / XML-RPC `execute_kw` (lectura). La cola de *venta* se mantiene aparte.

### Fase 1 — Lectura liviana y bandeja (conteo)

5. `search_read` `stock.lot` filtrado por producto/categoría DRY + quant qty > 0.
6. Persistir candidatos (tabla `OdooLotCandidate` o equivalente), **sin** crear `Container`.
7. UI: listado para conteo (serial, tipo Odoo, ubicación, DUA, ¿ya asimilado?).
8. Delta: próxima corrida solo `write_date` > última o ids nuevos. Nunca re-paginar todo + adjuntos.

### Fase 2 — Asimilar a Recepción (regularización)

9. Acción **Asimilar**: crea `Container` con ISO normalizado. Único error duro: serial vacío o ISO ya existente (entonces se enlaza, no se duplica).
10. Rellenar lo que venga (tara, color, año, fabricante, DUA crudo, notas). Tipo/condición: mapa o placeholder.
11. `status = Pendiente de ingreso`, `physicallyReceived = false`, `intakeType = pendiente_factura`, `mediaStatus = pendiente`, `intakeOrigin = odoo`.
12. Aparece en la bandeja de Recepción que Almacén ya usa.
13. Almacén: fotos (cámara), datos físicos, evaluación piso/techo/puertas/pintura, Gate-In cuando corresponda.
14. Admin/gerente: aprueba ficha → se aplica marca de agua a las copias públicas → catálogo.

### Fase 3 — Fotos de Odoo (opcional, no bloquea)

15. Por lote asimilado, listar `ir.attachment` del chatter.
16. Bajar solo adjuntos nuevos (checksum). Inbox, no slots.
17. UI en ficha: “Traídas de Odoo” + “Usar en casilla N”.

### Fase 4 — Compras (deuda consciente)

18. Resolver OC desde el lote (movimientos o texto de línea). Guardar referencia; no inventar factura ZDRY.
19. Cuando Compras cargue la factura: enlazar `purchaseInvoiceId`, pasar `invoicePending = false`, `intakeType = compra` si aplica, nacionalizar DAM cuando el formato se acepte.
20. Precio unitario Odoo (1 325 USD en el ejemplo) → `fobCif` solo al confirmar el enlace, no al asimilar.

### Fase 5 — Operación continua

21. Job o botón “Buscar diferencias” (superadmin / compras): candidatos nuevos + deltas de campos vacíos en ZDRY.
22. Auditoría: quién asimiló, qué cambió, de qué `odooLotId`.
23. No borrar en ZDRY si el lote deja de estar a la mano en Odoo: avisar (“ya no está a la mano”) y que Almacén archive o despache. Odoo no mueve el patio.

---

## 8. Roles

| Quién | Qué |
|---|---|
| Superadmin | Credenciales Odoo, mapa ubicación↔depósito, marca de agua, disparar sync / ver errores. |
| Almacén | Conteo en bandeja, asimilar, regularizar ficha, fotos, evaluación de condición, patio. |
| Compras | Enlazar OC/factura/DAM cuando se abra la deuda. |
| Admin / gerente | Aprobar publicación (marca de agua), precios. |
| Vendedor / cliente | No ven evaluación piso/techo ni DUA crudo ni ids Odoo. |

Personas no crea el rol superadmin. El conector no se configura en el login.

---

## 9. Riesgos abiertos (decidir antes de codear)

1. **Ambiente.** Test vs producción: una sola config activa; no asimilar la BD neutralizada al patio real.
2. **Seriales en texto en la OC.** 21 ISO en un párrafo no son 21 FK. La unidad nace del `stock.lot`, no del texto.
3. **Lotes qty ≠ 1 o sin quant.** Fuera de la bandeja de asimilación automática.
4. **Equivalencia de producto.** Sin tabla, el catálogo mentiría el tipo; mejor placeholder visible.
5. **DUA vs DAM.** No romper nacionalización existente: campo crudo aparte o validador dual.
6. **Peso 26 590 vs tara 3 890.** Confirmar MGW con negocio; un swap ensucia ficha y flete.
7. **Fotos chatter.** Derechos y peso; no son inspección ZDRY.
8. **Doble inventario.** Comunicar a Almacén: “en Odoo a la mano” ≠ “en patio ZDRY”.
9. **Idempotencia.** Misma serie asimilada dos veces = conflicto ISO. Enlazar, no clonar.
10. **Carga masiva vs uno a uno.** La bandeja puede tener *N* candidatos; el alta a `containers` es por selección (o “asimilar esta página”), nunca un import ciego de 500 lotes el primer día.

---

## 10. Criterio de hecho (esta fase)

Se considera lista para **conteo y regularización** cuando:

- Superadmin conecta y lista lotes DRY a la mano sin bajar fotos.
- Almacén ve la bandeja, asimila un serial (solo código) y la unidad aparece en Recepción pendientes.
- La web pública **no** muestra esa unidad hasta haber foto activa + aprobación.
- Una segunda sync no duplica ni pisa lo que Almacén ya escribió.
- La OC y la factura quedan referenciadas o pendientes, sin bloquear el alta.

No se considera cerrada la integración de compras ni el sync de venta a Odoo.

---

## 11. Relación con el contrato de producto

`proyecto_zdry.md` §1.5: ZDRY opera el patio; Odoo es administrativo; Odoo no mueve contenedores.

Esta integración **añade** una flecha inversa, limitada a *existencia y ficha*, no a *posición ni venta*. No contradice el contrato si:

- el patio solo cambia por Almacén,
- el catálogo solo cambia por aprobación,
- Odoo no se satura,
- el cierre comercial ZDRY → Odoo sigue en su cola.

El caso de aplicación (`caso_aplicacion.md`) queda cubierto por las fases 0–2 para el conteo, 3 para fotos, 4 para la deuda de compras.

# J3 reto — Asimilar de una vez, conciliar por serie y no volver a Odoo

Fecha: 20-sep-2026. Complementa [J3-conciliar-reentrega.md](J3-conciliar-reentrega.md). Cómo superar desafíos, riesgos y sprints con tests: [j3_reto_sprints.md](j3_reto_sprints.md).

Copia canónica también en Odoo: `zgroup/documentacion/fases/j3_reto.md`.

Lidera ZDRY. Odoo: enriquecer payloads del puente + ACL de factura cuando la habiliten.

---

## 1. Qué ya está (J3 mínimo) y qué falta

| Ya está | Falta (este reto) |
|---------|-------------------|
| Reentrega en patio sin papeles; campo/fotos no se bloquean | Aviso al admin cuando **aparece un DRY nuevo** en Odoo que coincide con una reentrega (no solo si abre Conciliar) |
| Match **auto** solo si ISO normalizado igual (`BMOU434933-2` = `BMOU4349332`) | Misma regla; no inventar “parecido” por tipo/año/color |
| Texto de línea OC = propuesta, no auto | Igual |
| IN borrador no concilia; IN parcial = solo series de *ese* IN | Mostrar la OC completa y **todos** sus INs (06302, 06435, 06460…) como un solo bloque |
| Confirmación humana: `costSource=oc`, `fobCif` de la OC | Precio de **MO** = precursor + componentes (hoy usa referencial genérico) |
| Expediente guarda un recorte del evento | Dejar de pintar `JSON.stringify`; ficha humana de OC / IN / OUT / MO / factura |
| Abrir ficha pide notas/fotos otra vez a Odoo | Una pasada de asimilación + copia local; API solo si hay delta, archivo o “Traer de Odoo” |
| `bill_posted` existe; a menudo solo el **nombre** (`C 3303`) | Factura **pendiente** hasta que den ACL; no inventar factura ZDRY |

Casos de lectura (staging 20-sep-2026):

- Serie `BMOU434933-2`: expediente muestra OC/IN/factura como JSON. En Odoo la OC `0010009472` es un bloque: ECONTAINERS, 21 ud × 1 325 = 27 825 USD, chatter de certificados.
- La misma OC tiene **tres** incoming done: `ZGROU/IN/06302`, `06435`, `06460`. El detalle de `IN/06460` lista ~11 series (CAIU…, BMOU…, INKU…).
- Fabricación: `LATU901117-1` / `ZGROU/MO/00292` — mismo serial, dos productos; la MO consume el DRY original **y** soldadura, perfiles, pintura, etc. ZDRY hoy no suma esos ítems.

---

## 2. Proceso de negocio (cómo debe sentirse)

Dos tiempos. No se espera la OC para meter el equipo a patio.

```
Patio (día 0)                         Odoo (días / semanas después)                    ZDRY
─────────────────────────             ──────────────────────────────────               ─────────────────────────
Coordinador: reentrega                Compras: OC + factura proveedor                  Puente: po_confirm / bill_posted
ISO en ZDRY, sin odooPoId             Almacén: valida IN (parcial o total)             Puente: picking_in_done + ISOs
Campo y fotos OK                      Series DRY nuevas a la mano                      Compara ISO vs reentregas
                                      MO (si transforma)                               Aviso admin: Conciliar
                                                                                       Humano confirma → amarre
```

Regla de identidad: **el mismo número de serie**. “Similares” = mismo serial normalizado (guion, espacios, dígito). Dos DRY 40HC del mismo IN **no** son el mismo equipo.

El admin no abre Odoo para ver proveedor, totales, INs, series por albarán, ni por qué una MO vale X. Eso vive en ZDRY, copiado.

---

## 3. Arquitectura objetivo

```
Odoo (fuente)                         Puente                         ZDRY (copia + operación)
─────────────                         ──────                         ────────────────────────
stock.lot / quant                     lot_write, quant_change        OdooLotCandidate + Container
purchase.order + lines                po_confirm                     OdooDocSnapshot kind=purchase (bloque rico)
stock.picking IN/OUT + lots           picking_in/out_done            kind=picking_in / picking_out
account.move in_invoice               bill_posted                    kind=bill  o  estado "pendiente"
mrp.production + raw moves            mo_done                        kind=mo + líneas de costo
mail.message / ir.attachment          lot_note                       UnitNote; fotos = meta ya, bytes on-demand
```

Contrato:

1. **Asimilación** = proceso general (sync o job) que trae de una vez lo estructurado. Barra de progreso para el admin (lotes, OC, INs, MOs, facturas, notas).
2. **Local primero.** La ficha y el expediente leen Postgres. No `search_read` por cada clic.
3. **Odoo otra vez solo si:** el puente marca delta en un modelo de interés; el usuario pide refresco; o hay que bajar un archivo (foto, PDF).
4. **El puente es semáforo**, no almacén. Indica que hubo acción en movimientos, salidas, productos, OC, factura, MO. ZDRY aplica el delta sobre la copia.
5. **Odoo sigue siendo dueño** de OC/IN/MO/factura. ZDRY no crea OC ni valida el incoming.

---

## 4. Huecos actuales (por qué duele)

### 4.1 Documentos como JSON

`OdooLotFicha` pinta `g.current.data` con `JSON.stringify`. El snapshot del evento es un recorte (`partner`, `amount_total`, `lot_ids`…). El usuario ve claves, no la OC. Una OC de 21 unidades se fragmenta por lote en lugar de un bloque compartido.

### 4.2 Consulta a Odoo al abrir el asimilado

`getOne` vuelve a tirar `pullOdooNotes` (y las fotos van por `mail.message` / `ir.attachment`). Sensación: “recién está consultando la API”. El objetivo es lo contrario: una pasada cara, lecturas baratas.

### 4.3 Precio de fabricación incompleto

`assimilateCostPlan` para MO deja `fobCif=0` y `costSource=mo`. El marketplace usa el **promedio referencial de OC** (ajustes ignorados), no el costo de esa MO. No se listan los componentes. El admin no entiende el valor.

En Odoo ya existe metodología en `zg_costo_producto_transformado` (serie origen + OC operativas + indirectos). ZDRY no la lee.

### 4.4 Factura incompleta o inaccesible

El sync lee `account.move` por `invoice_ids` de la OC; el puente manda `bill_posted` con cabecera. Sin grupo de Contabilidad en el usuario API suele fallar o quedar solo el nombre. **No hay PDF ni líneas.** Hasta que habiliten acceso: estado **pendiente**, no inventar `PurchaseInvoice` ZDRY.

---

## 5. Proceso para implementar (orden)

No mezclar con J4 (foto única) ni J5 (SO). Cada corte tiene prueba y “hecho cuando”. Si hay que tocar el addon Odoo, **subir e instalar antes** de validar (mismo criterio que J2).

### Corte A — Ficha humana de documentos (local)

**Qué:** dejar de mostrar JSON. Plantillas por `kind`:

| Kind | Bloque |
|------|--------|
| `purchase` | Número, proveedor, moneda, estado, fecha, total, precio unitario DRY, qty pedida/recibida, lista de INs de esa OC, series por IN |
| `picking_in` / `picking_out` | Nombre, origen (OC), fechas, origen/destino, series (no solo `lot_ids`) |
| `bill` | Nombre, proveedor, total, fecha, OC ligadas; si faltan líneas/PDF → badge **Pendiente (sin ACL)** |
| `mo` | MO, producto terminado, precursor + serial, fecha, lista de componentes (aunque el costo aún no sume) |

**Cómo:** enriquecer el snapshot en el sync (una lectura por OC/IN/MO, no por cada apertura de ficha). Varios lotes de la misma OC apuntan al **mismo** documento versionado.

**Prueba:** `BMOU434933-2` muestra OC-0010009472 como ficha; se ven IN/06302 y los demás INs de esa OC. No hay `<pre>` JSON en Expediente.

**Odoo:** ampliar payload de `po_confirm` / `picking_in_done` (líneas, series, INs). Si no se actualiza el módulo, ZDRY puede `search_read` **una vez** al asimilar y cachear.

### Corte B — Asimilación de una vez + barra + local-first

**Qué:** job/proceso “Asimilar expediente Odoo” (desde bandeja o al sync):

1. Productos DRY y quants (ya existe).
2. Por lote: origen, OC, INs, MO, factura (o pendiente), notas texto, **metadatos** de adjuntos (no todos los bytes).
3. UI: barra (paso N de M, ISO actual, errores).
4. `getOne` / Expediente / Recepción leen DB. Fotos: URL local o proxy solo al abrir el thumb. Botón “Traer de Odoo” = refresh explícito.

**Prueba:** abrir 5 fichas seguidas no dispara ráfaga de `search_read` (logs API). Sync con 50 lotes muestra progreso. Un `lot_note` nuevo vía puente actualiza notas **sin** reabrir Odoo a mano.

**Implicancia:** no bajar el filestore entero (eso es J4 + on-demand).

### Corte C — Alerta de conciliación cuando nace un DRY

**Qué:** al llegar `picking_in_done` / `po_confirm` / sync de lotes nuevos:

1. Normalizar ISOs del evento.
2. Cruzar con `Container` reentrega (`invoicePending` / `pendiente_factura` / sin `odooPoId`).
3. Si hay hit: propuesta en bandeja **y** badge/aviso a admin-compras (contador ya existe; falta notificación visible en Inicio / Compras).
4. Confirmación humana igual que J3. Segundo match → 409.

**Prueba:** coordinador crea reentrega `BMOU434933-2` (si no existe). Se valida `IN/06302` o se simula el evento. Admin ve la propuesta sin pulsar “Buscar”. Confirmado: marketplace usa 1 325, no el referencial.

**No hacer:** match por “40HC + CREMA + 2021”.

### Corte D — Costo real de MO

**Qué:** para `odooIntakeKind=fabrication`:

1. Leer MO done: producto terminado, lote precursor, `move_raw_ids` / movimientos consumidos.
2. Valorizar cada componente (costo estándar o OC del insumo / serie origen).
3. `costo_mo = precursor + Σ componentes` (prorrateo si la MO saca más de una unidad).
4. Guardar desglose en el snapshot `mo` (ítem, qty, costo, origen).
5. Referencial de esa unidad = `costo_mo`, no el promedio J1. Ajustes siguen en referencial OC.

Reutilizar idea de `zg_costo_producto_transformado` (serie origen + OC operativas). No hace falta clonar el PDF; sí las cifras que el admin necesita para creer el precio.

**Prueba:** `LATU901117-1` / MO/00292 lista insumos y un total > 0. El marketplace no usa el promedio de 1 325 si esa MO costó otra cosa. Spec de `moCostBreakdown`.

**Desafío:** si Odoo no tiene costeo cargado, marcar **incompleto**, no rellenar con el promedio a escondidas.

### Corte E — Factura: pendiente ahora, cuerpo cuando haya ACL

**Qué:**

- Sin lectura: badge “Factura Odoo pendiente — sin acceso a `account.move`”.
- Con nombre y sin líneas: “Referencia C 3303 — detalle pendiente”.
- Con ACL: líneas, impuestos, fecha, PDF on-demand (archivo, no en el sync masivo).
- No crear factura de compra ZDRY automática (sigue Compras → Deuda Odoo).

**Odoo:** usuario API + grupo que permita `account.move` proveedor (cuando lo habiliten). Documentar en la guía de instalación del módulo.

**Prueba:** con ACL tapada, la ficha no rompe. Con ACL, el bloque factura deja de estar pendiente.

---

## 6. Implicancias

### Negocio / ZDRY

- Patio no espera papeles. Compras no adivina el amarre: el sistema avisa; el humano confirma.
- El marketplace deja de mentir en fabricación (referencial realista) y en reentrega conciliada (precio OC).
- Menos idas a Odoo = menos error operativo y menos carga JSON-2.

### Odoo

- El addon debe emitir **payload rico** (líneas, series, INs de la OC, componentes MO). Versión de módulo a subir **antes** de validar cortes A/D.
- Usuario API: Inventario + ZDRY Bridge API; Contabilidad **cuando** autoricen factura. Sin validar recepciones ni asientos.
- `zg_costo_producto_transformado` y `date_sotck_move` son lectura, no se reescriben desde ZDRY.
- Anti-eco `zdry_sync` se mantiene. ZDRY no llama `button_validate` ni `button_confirm`.

### Datos y frescura

- Copia local **se queda vieja** si el cron/webhook del puente falla. Mitigación: poll 45 s (J2) + “Traer de Odoo” + barra de re-asimilación.
- Versionar documentos (`OdooDocSnapshot`): un write en Odoo = nueva versión; la ficha muestra la última.
- Archivos (fotos, PDF factura) no van en la pasada inicial: metadatos sí, bytes al ver o J4 (una foto de referencia).

### Identidad y riesgo

| Riesgo | Mitigación |
|--------|------------|
| Amarre por “parecido” (tipo/color) | Solo ISO normalizado; texto de línea = propuesta |
| Amarre de toda la OC a una reentrega | IN parcial: solo series de ese picking |
| Reentrega pisada por “Buscar en Odoo” | Ya: no volcar OC/costo a `pendiente_factura` sin confirmar |
| MO sin costos en Odoo | Estado incompleto; no usar promedio oculto |
| Factura sin ACL | Pendiente visible; no inventar factura ZDRY |
| Sync masivo tumba Odoo.sh | Lotes + barra; puente para el delta diario |
| Filestore saturado | No bajar todas las fotos en el job (J4 / on-demand) |

### Fases siguientes

- **J4** (foto única a Odoo) encaja con “archivos on-demand”; no bloquea A–E.
- **J5** (SO / semáforo) necesita costo creíble: D debe estar verde antes de vender fabricación como si fuera OC.
- **J6** (ya no a la mano) usa los mismos eventos de picking; la copia local de INs/OUTs es el input.

### Roles

| Rol | Qué ve / hace |
|-----|----------------|
| Coordinador | Sigue creando reentrega; no ve tarifas ni Odoo |
| Compras / admin | Barra de asimilación, bandeja Conciliar, aviso de hits, confirma amarre, lee ficha OC/MO |
| Gerente / vendedor | Precio de lista derivado del `fobCif` / costo MO ya asentado; no ven Odoo |

---

## 7. Desafíos técnicos (resumen)

1. **Una OC, varios INs, muchas series.** Modelo documental 1:N (documento → series), no snapshot suelto por lote.
2. **Mismo serial, dos `stock.lot`** (fabricación). El vendible es el lote a la mano; el precursor y la MO son el expediente de costo.
3. **ACL factura** inestable hasta que habiliten. La UI debe nacer con “pendiente”.
4. **Costeo MO** depende de datos Odoo (`stock.valuation`, estándar, o reporte ZGROUP). Definir fuente en el corte D y testear `MO/00292`.
5. **Progreso real** = job con pasos persistidos (no un spinner eterno de un solo HTTP).
6. **No reconsultar** implica disciplina: todo `search_read` de ficha pasa a “si cache miss o refresh=1”.

---

## 8. Hecho cuando (reto completo)

- [x] Expediente de una serie de compra se lee como ficha (OC + INs + series + factura o “pendiente”), sin JSON crudo.
- [x] Abrir fichas ya asimiladas no martilla la API Odoo (salvo fotos/PDF o refresh).
- [x] Un IN done con ISO igual a una reentrega avisa a admin/compras; el confirm amarra y cambia el costo a OC.
- [x] Una MO muestra componentes y un costo unitario sumado; el marketplace usa ese valor, no el promedio de ajustes.
- [x] Factura sin ACL se ve pendiente; con ACL se rellena el bloque.

---

Cierre 20-sep-2026: diario de asimilación, costo MO valorizado, extras y líneas editables en ZDRY. J3 queda cerrado.

---

## 9. Fuera de este reto

Crear OC o validar picking desde ZDRY. Foto única de referencia a Odoo ([J4](J4-foto-unica.md)). Crear `sale.order` (J5). SUNAT, GRE, asientos, conciliación bancaria.

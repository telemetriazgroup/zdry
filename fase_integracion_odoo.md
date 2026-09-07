# Fases de integración Odoo → ZDRY

Implementación de `implicancias_integrar_odoo.md`, con tres ajustes de operación:

1. **Las unidades ya están en almacén.** No es un gate-in de llegada. El operario en campo ve un DRY, abre **Patio — campo**, y sube fotos o notas. No ve ni edita Odoo. Quien publica evalúa. La integración solo trae la ficha para poder contar y completar.
2. **ISO 6346 no bloquea** el alta desde Odoo. Si el serial no cumple, se crea igual y se **resalta para revisión**.
3. **La ubicación Odoo es un almacén.** Si no existe en ZDRY, se crea como depósito al asimilar.

Ambiente de las capturas = test. Producción es otra URL/BD (superadmin).

---

## Fase 0 — Conexión (lista para operar)

- Superadmin guarda URL, BD, usuario y clave (las mismas que ya leyeron Contactos).
- Botón **Probar conexión**: `version` + `authenticate` + una lectura mínima (`res.users` / `res.partner`).
- El cliente JSON-2 (`/jsonrpc`) vive en `OdooClient`. La cola de *venta* ZDRY → Odoo no se mezcla.
- Si no hay credenciales, el sync no corre y lo dice claro.

**Hecho cuando:** superadmin ve “conectado” o el error real de Odoo, sin tocar patio.

---

## Fase 1 — Bandeja de candidatos (conteo)

- Lectura: productos DRY → `stock.quant` qty > 0 **y ubicación interna (a la mano)** → `stock.lot` con ficha completa. No baja clientes ni ubicaciones virtuales.
- Se persisten **candidatos** (`OdooLotCandidate`), no `Container`.
- Delta por `write_date` / id Odoo. No se bajan fotos.
- Serial normalizado (sin guion). Se calcula si pasa ISO 6346; si no, `iso6346Ok = false`.
- UI **Odoo / regularizar**: listado de 20 en 20, buscador, **seleccionar todo excepto por revisar**, ficha tipo Odoo al abrir un lote.
- **Reiniciar módulo** (admin): vacía candidatos y unidades asimiladas no vendidas para depurar de cero.
- Visible para superadmin y admin. Almacén no entra a la bandeja Odoo.

**Hecho cuando:** “Buscar en Odoo” llena la bandeja sin crear unidades.

---

## Fase 2 — Asimilar y regularizar en campo (esta entrega)

- **Asimilar** (uno o selección): crea `Container` con el código y copia lo que Odoo traiga (tara, peso, color, DUA, procedencia, año, fabricante). Esos valores quedan como **solicitante** (`odooSource`) y no bloquean si faltan.
- ISO inválido: se crea con `isoException` y badge **ISO a revisar**. No se rechaza. El operario marca **ISO revisado** en Recepción cuando lo valida en campo.
- Ubicación Odoo → depósito ZDRY. Si no hay, **se crea el almacén** (nombre = ubicación).
- La unidad **ya está en almacén**: `physicallyReceived = true`, `intakeOrigin = odoo`, factura pendiente (OC en deuda).
- Entra a **Recepción** (admin: asigna fotos de Odoo a las 9 casillas del catálogo) o a **Patio — campo** (operario: fotos y notas, sin ver ni editar Odoo).
- Segunda asimilación del mismo serial: se enlaza, no se duplica.
- Odoo no asigna lado/ruma/columna ni publica en la web.

**Hecho cuando:** un serial de la bandeja aparece en Recepción; el operario puede completar fotos; la web no lo muestra hasta aprobar.

---

## Fase 3 — Ficha, fotos chatter y write-back

- Ficha similar a Odoo: producto, ubicación, color, tara, peso, DUA, procedencia, material, año, fabricante.
- Fotos del chatter en la ficha (vista previa) y **abajo en Recepción** para asignarlas a una casilla del catálogo, o reemplazarlas con foto de campo.
- **Odoo (se escribe de vuelta)** vs **complemento ZDRY** (tipo, condición, notas).
- Guardar no bloquea: primero ZDRY, luego Odoo en segundo plano. Icono **en vivo** / **diferido** / error.

---

## Fase 4 — Compras (deuda) (esta entrega)

- Resolver OC / factura desde el lote (`stock.move.line` o seriales en texto de la línea de OC). Guardar referencia; no inventar factura ZDRY al asimilar.
- Ficha Odoo muestra OC, proveedor, factura Odoo y precio unitario (solo lectura).
- Compras → **Deuda Odoo**: listar, seleccionar y enlazar (stub o factura existente). Al confirmar: `purchaseInvoiceId`, `invoicePending=false`, `intakeType=compra`, `fobCif` del precio Odoo si hay.
- DUA crudo (`odooDua`) ≠ DAM ZDRY (`damNumber`).

---

## Patio — campo (operario)

- Interfaz propia: fotos e información de campo. **No ve fotos de Odoo** y **no modifica** tara, peso, color, DUA, procedencia ni fabricante.
- Envía a evaluación. Quien publica en Ficha catálogo decide si sale a la web.
- Recuento diario (hora Lima): equipos regularizados y publicados.

---

## Fase 5 — Evaluación admin y marca de agua (esta entrega)

- Piso / techo / puertas / pintura (bueno · regular · malo): Patio campo y Ficha catálogo. Nunca en el API público.
- Marca de agua al **aprobar** publicación: copia en `public/{iso}/photos/{slot}.jpg` (`publicKey`). El original de inspección no se toca.
- Admin/gerente sube logo (`catalog_watermark`). Si no hay logo, solo texto ZDRY.

---

## Fase 6 — Operación continua

- Botón “Buscar diferencias”: lotes nuevos + deltas en campos vacíos.
- Si deja de estar a la mano en Odoo: aviso, no borrar ni mover patio.
- Auditoría de quién asimiló y qué se regularizó.

---

## Orden de trabajo

| Fase | Estado |
|---|---|
| 0 Conexión | En esta entrega |
| 1 Bandeja candidatos | En esta entrega |
| 2 Asimilar + regularizar en Recepción | En esta entrega |
| 3 Ficha + fotos + write-back | En esta entrega |
| 4 OC / factura | En esta entrega |
| 5 Evaluación + watermark | En esta entrega |
| 6 Delta continuo | Pendiente (sync manual ya cubre el primer delta) |

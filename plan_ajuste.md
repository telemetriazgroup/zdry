# Plan de ajuste — reentrega, campo, costos y puerta

Implementación de `modificaciones_zry.md`. No toca el sync Odoo (fases 0–5 de `fase_integracion_odoo.md`): se apoya en Recepción, Patio campo y Ficha catálogo.

**Principio:** el coordinador de despacho **habilita**; el personal de campo **toma y diagnostica**; el admin **acepta fotos para la web**. Nadie de patio ve precios ni ficha Odoo.

---

## Actores

| Actor | Rol técnico | Qué hace | Qué no hace |
|---|---|---|---|
| Coordinador de despacho | `coordinador` (nuevo) | Alta reentrega mínima, enviar a campo (manual u Odoo), asignar fotos a casillas, corregir diagnóstico, completar ficha, costos sin monto, documentos, transportistas, vincular visita a ISO | Publicar catálogo, ver/editar tarifas, bandeja Odoo |
| Personal de campo | `almacen` (restringido) | Lista de habilitados + visitas de tracto; fotos/video; piso/techo/paredes/pintura; hueco techo; observaciones | Crear ingresos, Odoo, precios, asignar casillas de catálogo, documentos EIR |
| Administrador | `admin` / `superadmin` | Precios de conceptos, aceptar/rechazar fotos, publicar, Odoo | — |

Seed: `coordinador@zdry.pe` / `Zdry123!`. Admin conserva Recepción como vista total.

---

## Flujo objetivo

```
Coordinador: ISO + tipo + depósito  →  “Enviar a campo”
     ↓
Campo: lista → fotos/video + diagnóstico (incluye hueco techo)
     ↓
Coordinador: asigna cada toma a casilla 1–9, corrige notas, completa ficha Odoo-like
     ↓  Gate-In se aplica al habilitar (costo de ingreso)
Coordinador: “Registrar actividad” (lavado, movimiento, reparación…) sin ver $
     ↓
Admin: Ficha catálogo acepta/rechaza y publica (marca de agua ya existe)
```

En paralelo: transportista llena el formulario público (QR) → coordinador verifica y vincula al ISO → campo ve la visita junto a la unidad habilitada.

---

## Qué no se reabre

- Sync / write-back Odoo, deuda OC, marca de agua, catálogo público.
- `Despachos` de venta (guía, flota, UC-60). Este plan es **ingreso y puerta**, no salida comercial.

---

## Fase A — Roles y alta mínima

**Objetivo:** el coordinador crea una reentrega y la manda a campo sin fotos ni año.

- Rol `coordinador` en Prisma, seed, nav, `@Roles`.
- `almacen` sale de Recepción. Solo Patio campo + (más adelante) llegadas.
- Alta: ISO, tipo, depósito, `intakeType=pendiente_factura`. ISO 6346 **no bloquea** (igual que Odoo): se crea con `isoException` si falla el dígito.
- Flag `campoEnabledAt` / `campoEnabledBy`. Campo **solo** lista `campoEnabledAt != null`.
- Confirmación actual (año/fabricante obligatorios) **no** aplica a este envío.
- Posición opcional desde el día uno.

**Hecho cuando:** coordinador crea `CAIU…`, campo lo ve en la lista; admin no hace falta. Almacén ya no entra a “Nuevo ingreso”.

**Archivos:** `schema.prisma`, `auth.jsx`, `People.jsx`, `warehouse.service` `intake` + `campoQueue`, `Recepcion.jsx`, `Shell.jsx`, `usuarios_prueba.md`.

---

## Fase B — Combobox y ficha recíproca

**Objetivo:** el coordinador completa datos como en Odoo, sin listas muertas.

- Color y fabricante: buscador + “crear si no existe” (maestro o valor libre persistido).
- Año: 1980–año actual; fuera de rango → error claro, no se guarda.
- Misma ficha que el lote Odoo: tara, peso, color, DUA, procedencia, material, año, fabricante. Complemento ZDRY: tipo, condición comercial, notas.
- Unidades asimiladas Odoo: el coordinador **elige** cuáles enviar a campo (no entran todas solas).

**Hecho cuando:** se agrega color “Crema”; año 1979 muestra error; un asimilado Odoo no aparece en campo hasta “Enviar a campo”.

**Archivos:** `CONTAINER_COLORS`, `MANUFACTURERS`, `Recepcion.jsx` / nueva `Coordinacion.jsx`, `odoo-lot-map.ts` (campos), maestros si se extrae color/fabricante a tabla.

---

## Fase C — Toma de campo vs casillas de catálogo

**Objetivo:** campo no decide el sector; el coordinador sí.

- Campo sube a una **bandeja de tomas** (foto/video + nota libre), no a slot 1–9.
- Diagnóstico de campo: piso, techo, **paredes**, pintura (`bueno|regular|malo`), **hueco en techo** (sí/no), observaciones.
- Coordinador: ve las tomas, las asigna a las 9 casillas (o video 360), corrige el diagnóstico.
- Admin sigue publicando en Ficha catálogo. Se pueden añadir tomas en cualquier momento del proceso.
- Fotos verticales: aviso al coordinador al asignar (ya existe aviso al publicar).

**Hecho cuando:** campo sube 4 fotos sin elegir “Frontal”; coordinador las reparte; admin publica. El original de patio no se toca (regla ya vigente).

**Archivos:** modelo `FieldCapture`, PatioCampo, UI coordinador de asignación (hoy está mezclada en Recepción/Odoo chatter), `conditionFloor` + `roofHole`.

---

## Fase D — Costos de patio

**Objetivo:** Gate-In al habilitar; actividades sin mostrar $ al coordinador.

- Tabla `DepotCostConcept` (gate_in, gate_out, reparacion, lavado, movimiento, …) con precio. Admin/superadmin editan precio y pueden **agregar conceptos**.
- Al enviar a campo / confirmar ingreso: se registra **Gate-In** automático (una vez por unidad).
- Coordinador: botón **Registrar actividad** → modal (concepto + observación). No ve monto.
- Admin: ve monto, historial y C_T / inventario.
- Reemplaza los botones de Recepción que hoy dicen “Sprint 8”.

**Hecho cuando:** coordinador registra “Lavado — salitre en puertas” y no ve $45; admin sí lo ve en la unidad.

**Archivos:** `DEPOT_SERVICE_RATES` → persistido, `toggleGate` / `registerService`, Configuración (conceptos), modal en ficha coordinador.

---

## Fase E — Documentos por unidad

**Objetivo:** EIR, constancia de conductor, etc., fuera de las 9 fotos de catálogo.

- Adjunto (PDF/imagen) + **concepto** + observación.
- Conceptos iniciales: Recibo de intercambio de equipo, Constancia de conductor, Otro.
- Visible a coordinador y admin. Nunca al catálogo público ni a campo (salvo que más adelante se pida).

**Hecho cuando:** coordinador sube un EIR con concepto; no aparece en la ficha web.

**Archivos:** `ContainerDocument` (similar a documentos de factura de compra), UI en ficha coordinador.

---

## Fase F — Transportista y QR de puerta

**Objetivo:** el tracto se identifica en portería; campo ve quién llega y qué DRY inspeccionar.

Campos: empresa, RUC, conductor, hora, brevete, placa tracto, motivo (cargar | descargar), placa carreta, teléfono, código de equipo (opcional hasta vincular).

- Formulario **público** `/zdry/visita` (o QR que apunta ahí). Sin login.
- Clave: **placa de tracto**. Si ya existe y **no está vinculada** a un ISO: muestra datos y permite corregir.
- Al vincular el coordinador a un contenedor: queda **cerrado** (solo admin puede desvincular).
- Coordinador: lista de visitas pendientes, verificar, asignar ISO.
- Campo: en la misma pantalla de patio, “llegando ahora” (visita vinculada o pendiente de hoy) + DRY habilitado.

**Hecho cuando:** el chofer abre el QR, pone placa ya usada, ve su ficha; tras vincular a `CAIU…` no puede editar; campo ve tracto + ISO.

**Archivos:** `GateVisit`, ruta pública, QR estático (URL fija de portería), Coordinación, PatioCampo.

---

## Orden y dependencias

| Fase | Depende de | Entrega usable |
|---|---|---|
| A Roles + alta + enviar a campo | — | Coordinador y campo separados |
| B Combobox + ficha Odoo-like + envío selectivo Odoo | A | Datos de regularización |
| C Tomas vs casillas + hueco techo | A | Inspección como en el caso |
| D Costos reales + modal actividad | A, catálogo de conceptos | Gate-In y extras |
| E Documentos por unidad | A | EIR / constancias |
| F Visita pública + QR | A, E opcional | Puerta |

D, E y F pueden ir en paralelo después de A. C es el cambio de modelo de fotos: no mezclarlo con F.

---

## Criterios transversales

- Campo y coordinador: **cero** FOB, tarifas ni ids Odoo en API (`hideOdoo`, sin `serviceRates` en meta de campo).
- Catálogo público: sin evaluación, sin documentos, sin visitas, sin DUA crudo.
- Auditoría en cada envío a campo, actividad de costo, vínculo de visita y asignación de toma.
- Pruebas de dominio: año 1980, ISO inválido no bloquea, placa tracto duplicada, visita locked al vincular, Gate-In una sola vez.
- Verificar en navegador el flujo completo con `coordinador@zdry.pe` y `almacen@zdry.pe`.

---

## Fuera de este plan

- Módulo Despachos de **salida** (guía, precinto, flota).
- Fase 6 Odoo (delta continuo automático).
- SUNAT / facturación (sigue en Odoo).

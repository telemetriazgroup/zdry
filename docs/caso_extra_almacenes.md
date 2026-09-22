# Caso: extras de costo por almacén / proveedor + mapa de patios

**En implementación (2026-09-22).** Overlays de adquisición + mapa de patios del coordinador. No cierra J5 ni el PDF de cotización.

Relacionado: [J1-origen-y-precio.md](fases_conjunto/J1-origen-y-precio.md) · [plan_ajuste.md](../plan_ajuste.md) · [implicancias_integrar_odoo.md](../implicancias_integrar_odoo.md) · [observacion_cotizacion_odoo.md](observacion_cotizacion_odoo.md)

**Fecha:** 2026-09-22  
**Origen:** bandeja Odoo (236 lotes: `ZGROU/Existencias` y `Piura/Existencias`) + costos de referencia tipo/condición + decisión del coordinador de despachos.

---

## 1. Problema

Odoo ya entrega **dónde está el quant** y **cuánto costó la OC**. ZDRY usa el costo real de la unidad (`fobCif` / `odooUnitPrice`) para armar lista, pero:

1. El admin que fija el precio de venta **no ve de dónde viene** esa cifra (Callao vs Piura).
2. Hay costos que **no están en Odoo** o no se pueden asociar al producto (traslado interno, riesgo de proveedor, posicionamiento). Conviene cargarlos como **conceptos extras** sobre la base, no inflando el margen.
3. El referencial actual es solo **tipo + condición** (20GP 2800, 40HC 4200…). Se ignora en cuanto hay OC real.
4. `ZGROU/Existencias` **no es un patio ZDRY**. El coordinador debe bajar esa existencia a uno de tres almacenes físicos. `Piura/Existencias` sí es 1:1 con Piura.

Sin documentar las dos capas (costo vs patio) se va a mapear mal: o se pierde Piura en el precio, o se asigna solo “Existencias” y el coordinador no sabe a qué patio mandar la unidad.

---

## 2. Dos capas que no se deben fundir

| Capa | Pregunta | Quién decide | Grano |
|------|----------|--------------|-------|
| **A. Ubicación Odoo** | ¿De qué stock / plaza viene el costo? | Odoo (`stock.location`) | `Piura` vs `ZGROU` |
| **B. Patio ZDRY** | ¿En qué almacén físico vive para campo / despacho? | Coordinador de despachos | Piura · Principal · Gambeta 1 · Gambeta 2 |

Odoo dice **plaza de existencias**. El coordinador dice **patio operativo**. Los extras de costo se cuelgan de la capa A (y del proveedor). El envío a campo se cuelga de la capa B.

Hoy `titleFromLocation("ZGROU/Existencias")` y `titleFromLocation("Piura/Existencias")` ambos dan depot **“Existencias”**. Eso rompe las dos capas.

---

## 3. Mapa coordinador de despachos

Regla de negocio (2026-09-22):

| Ubicación Odoo (bandeja) | Patio ZDRY | Quién elige |
|--------------------------|------------|-------------|
| `Piura/Existencias` | **Almacén Piura** | Automático (1:1) |
| `ZGROU/Existencias` | **Principal** *o* **Gambeta 1** *o* **Gambeta 2** | Coordinador, al enviar a campo / recepcionar |

`ZGROU/Existencias` es un **cajón de existencias Callao** en Odoo. En patio real hay tres sitios. Odoo no dice cuál. No se puede auto-asignar `depotId` a “Patio Callao” genérico y darse por bueno.

### Flujo coordinador

```
Asimilar lote Odoo
  → queda pendiente de recepción / no publicado
  → odooLocation se conserva (ZGROU/Existencias | Piura/Existencias)
  → odooWarehouse = primer tramo (ZGROU | Piura)

Si Piura:
  depotId = Almacén Piura
  coordinador envía a campo en Piura

Si ZGROU:
  depotId queda sin patio fino (o “Callao — por asignar”)
  coordinador elige: Principal | Gambeta 1 | Gambeta 2
  recién ahí hay posición de patio (lado/ruma/columna)
```

El coordinador **habilita** campo; no ve precios (`plan_ajuste.md`). El admin ve almacén Odoo + patio elegido al decidir precio.

### Seed vs realidad

El seed actual no tiene estos cuatro patios. Tiene `Patio Callao`, `Patio Ventanilla`, `Patio Lurín`, `Patio Paita`. Al implementar hay que **crear / renombrar** maestros:

- Almacén Piura
- Principal
- Gambeta 1
- Gambeta 2

No reutilizar “Patio Callao” como si fuera los tres Gambetta. La dirección seed `Av. Néstor Gambetta 5500` es pista de zona, no de cuál de los tres patios.

---

## 4. Encaje en el precio (overlays de adquisición)

Cadena J1 actual:

```
Odoo OC / MO / ajuste
  → resolveAcquisition()     ← una cifra (fobCif o referencial tipo)
  → margen (22 % …)
  → priceList / priceMin
```

`resolveAcquisition`: si `fobCif > 0` usa **solo** la OC. Piura y ZGROU con la misma OC `$1,325` salen a la misma lista. El referencial tipo/condición es fallback, no ajuste de plaza.

### Modelo mental (el que hay que implementar después)

```
costo Odoo (OC / MO / referencial tipo)     ← no se pisa
+ extras de almacén Odoo (Piura, ZGROU)     ← admin, masivo
+ extras de proveedor (vendors de las OC)   ← admin, masivo
± extra puntual de la ISO                   ← admin, específico
= base ajustada
→ margen → lista / piso
```

Ejemplo bandeja:

| ISO | Origen | Costo Odoo | Almacén Odoo | Extra plaza | Extra vendor | Base | Lista ~22 % |
|-----|--------|------------|--------------|-------------|--------------|------|-------------|
| BMOU433548-9 | OC-0010009472 | 1325 | ZGROU | 0 (Callao) | 0 | 1325 | ~1699 |
| (misma OC, hypotética Piura) | OC-… | 1325 | Piura | 180 traslado | 0 | 1505 | ~1930 |
| APHU678930-9 | Ajuste | ref 1288 | ZGROU | 0 | — | 1288 | referencial |

El admin ve **de dónde sale cada dólar**. El margen sigue siendo comparable entre plazas.

### Qué no mezclar

| Pieza actual | Sirve para | No usar para |
|--------------|------------|--------------|
| Costos de referencia tipo/condición | Fallback sin OC | Extra Piura / vendor |
| Extras de compras (aduana, THC, flete) | Factura ZDRY manual | Lotes asimilados Odoo |
| `DepotCostConcept` | Gastos de patio por ISO | Base de adquisición |
| `QuoteExtra` | Flete/servicio al cliente | Costo interno |
| % margen por almacén | — | Distorsiona el margen |

`fobCif` / `odooUnitPrice` **siguen siendo la verdad Odoo**. Los overlays no se escriben encima.

---

## 5. Proveedores (OC)

Las OC asimiladas ya traen `odooVendorName`, `odooPoName`, `odooUnitPrice` (bandeja: ECONTAINERS, etc.). Hay que **listar todos los proveedores distintos** de candidatos + contenedores y dejar que el admin ponga conceptos extras por vendor (calidad, flete no asociado, interno no registrado).

Mismo overlay que almacén: masivo por vendor, apagable por ISO.

No es el maestro `Provider` de compras ZDRY (agente aduana / transporte). Es el partner de `purchase.order` de Odoo.

---

## 6. Cómo se implementaría (cuando se autorice)

Orden. No saltar el mapa de patios.

### Paso 0 — Identidad

- Persistir `odooWarehouse` = primer tramo de `locationName` (`ZGROU` | `Piura`).
- Conservar `odooLocation` completo.
- Maestros patio: Piura, Principal, Gambeta 1, Gambeta 2.
- Mapa:
  - `Piura` → depot Piura (auto).
  - `ZGROU` → depot pendiente; el coordinador elige uno de los tres al recepcionar / enviar a campo.

### Paso 1 — Admin: conceptos extras (masivo)

Nueva sección Configuración, junto a “Costos de referencia”:

- Catálogo de conceptos (traslado Piura, riesgo vendor, interno no-Odoo, libre).
- Asignar monto USD a **almacén Odoo** (`Piura`, `ZGROU`) y/o a **proveedor Odoo**.
- Flag: aplica a `oc` / `referential` / ambos.

Cambiar “Piura + $180” recalcula todas las unidades no-manuales de esa plaza.

### Paso 2 — Específico

Ficha / catálogo media:

- Desglose: `OC 1325 + Piura 180 + Vendor X 50 = base 1555 → lista …`
- Apagar un concepto en esa ISO.
- Extra one-off (nota + monto).
- `priceSource=manual` no lo pisa el recálculo.

### Paso 3 — Oráculo

En `computeListPrices`, **después** de `resolveAcquisition` y **antes** del margen:

```
raw      = resolveAcquisition(...)
overlays = extras(odooWarehouse) + extras(odooVendor) + extras(ISO)
base     = raw + sum(overlays)
priceList = base / (1 - margen)
```

Recálculo masivo (`refreshAcquisitionPrices` filtrado) hoy no existe; hay que añadirlo.

### Paso 4 — Coordinador

- Bandeja recepción: si `odooWarehouse=Piura`, patio ya puesto.
- Si `odooWarehouse=ZGROU`, obligatorio elegir Principal / Gambeta 1 / Gambeta 2 antes (o al) “Enviar a campo”.
- Coordinador no ve montos de extras ni lista.

### Paso 5 — Qué ve el admin al decidir venta

Bandeja Odoo + ficha:

- Almacén Odoo (origen del costo)
- Patio ZDRY (si el coordinador ya eligió)
- Proveedor + OC
- Costo Odoo vs base ajustada vs lista
- Badge `OC` / `Ajuste+ref` / `MO`

---

## 7. Actores

| Actor | Capa A (costo / extras) | Capa B (patio) |
|-------|-------------------------|----------------|
| Admin / gerente | Crea conceptos, montos, ve desglose, fija lista | Ve el patio ya elegido |
| Coordinador | No ve $ | Elige Principal / Gambeta 1 / Gambeta 2 si vino de ZGROU; Piura es automático |
| Compras | Ve OC / fobCif real | No asigna patio |
| Campo (`almacen`) | No ve $ ni Odoo | Trabaja en el patio que habilitó el coordinador |

---

## 8. Criterio de hecho (para cuando se implemente)

- [x] `Piura/Existencias` → patio Piura sin pregunta.
- [x] `ZGROU/Existencias` no aterriza solo en un “Callao”; el coordinador elige Principal, Gambeta 1 o Gambeta 2.
- [x] Extra de plaza se aplica por `ZGROU` / `Piura`, no por el patio fino (los tres Callao comparten extras ZGROU salvo que el admin cree un overlay por depot después).
- [x] Extra de proveedor se aplica a todas las ISO de ese `odooVendorName`.
- [x] `fobCif` no se muta; el desglose muestra Odoo + extras = base.
- [x] Unidades `priceSource=manual` no se recalcan.
- [x] Referencial tipo/condición sigue siendo solo fallback.
- [x] Coordinador sigue sin ver tarifas.

---

## 9. Preguntas abiertas (cerrar antes de codear)

1. ¿Los tres patios Callao (Principal, Gambeta 1, Gambeta 2) **comparten** el extra ZGROU, o más adelante habrá extra distinto por Gambeta?
2. Nombres oficiales de los tres patios y de Piura (¿“Almacén Piura”, “Sullana”, “Paita”?). El seed tiene Paita, no Piura.
3. ¿Un lote ZGROU puede moverse de Principal a Gambeta después? Si sí, el extra de costo **no** cambia (sigue siendo ZGROU); solo cambia `depotId`.
4. Lista inicial de conceptos extras (traslado Piura, ¿cuánto? ¿otros?).
5. ¿El extra ZGROU es $0 por defecto (solo Piura tiene recargo) o también hay interno Callao no registrado en Odoo?
6. Vendors: ¿match por nombre exacto de Odoo o hay que unificar razones sociales duplicadas?

---

## 10. Cómo repetir el análisis

1. Bandeja `/app/almacen/odoo`: filtrar `ZGROU/Existencias` vs `Piura/Existencias`; anotar OC y `odooVendorName`.
2. Configuración → Costos de referencia: comprobar que no hay fila por almacén (hoy no debe haberla).
3. Recepción: una ISO asimilada ZGROU — hoy cae en depot “Existencias” / Callao genérico; el coordinador no tiene los tres patios.
4. Al implementar: no tocar PDF cotización ni J5; solo base de precio + mapa de patios.

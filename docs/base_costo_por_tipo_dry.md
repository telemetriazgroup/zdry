# Base de costo DRY por tipo, condición y plaza

Casuística del **precio referencial** cuando la unidad no tiene OC propia (ajuste de inventario, MO sin costo, o origen desconocido). No pisa el `fobCif` de una OC real.

Relacionado: [caso_extra_almacenes.md](caso_extra_almacenes.md) · [J1-origen-y-precio.md](fases_conjunto/J1-origen-y-precio.md)

**Fecha:** 2026-09-22  
**Problema visto en bandeja:** un solo promedio global (`Ref. USD 1,288.55`) se aplicaba igual a `[CDD40H0004] 40 HC SEGUNDO USO` (ZGROU), `[CDD20F0003] 20 DC SEGUNDO USO` (Piura) y `[CDE0031] 20 DC NUEVO` (ZGROU). Las OC del mismo listado ya mostraban `$1,325` en 40 HC Callao.

---

## 1. Qué no es lo mismo

| Producto Odoo | Tipo ZDRY | Uso | Plaza | Costo que debe mandar |
|---------------|-----------|-----|-------|------------------------|
| `[CDD40H0004] CONTENEDOR DRY 40 HC SEGUNDO USO` | `40HC` | segundo uso | `ZGROU` | Promedio de OC 40 HC segundo uso en ZGROU (p. ej. 1325) |
| `[CDD20F0003] CONTENEDOR DRY 20 DC SEGUNDO USO` | `20GP` | segundo uso | `PIURA` | Promedio de OC 20 DC segundo uso en Piura |
| `[CDE0031] CONTENEDOR DRY 20 DC NUEVO` | `20GP` | nuevo (`1TRIP`) | `ZGROU` | Promedio de OC 20 DC nuevo en ZGROU |

Nuevo ≠ segundo uso. 20 ≠ 40. Piura ≠ ZGROU. El patio fino (Principal / Gambeta 1 / 2) **no** entra en esta cubeta: es decisión del coordinador, no del costo de origen.

---

## 2. De dónde sale cada cifra

Solo cuentan lotes con **OC real** (`costSource=oc` / `odooIntakeKind=purchase`) y `odooUnitPrice > 0`. Se ignoran ajustes (no circular).

Cubeta = promedio de esos precios, ventana `windowMonths` (default 24).

| Prioridad | Cubeta | Cuándo se usa |
|-----------|--------|----------------|
| 1 | SKU Odoo + plaza (`CDD40H0004` + `ZGROU`) | Hay ≥1 OC de ese código en esa plaza |
| 2 | Tipo + uso + plaza (`40HC` + segundo uso + `ZGROU`) | Caso normal |
| 3 | Tipo + uso (`20GP` + nuevo, cualquier plaza) | Esa plaza no tiene OC de ese uso; no mezcla nuevo con usado |
| 4 | Tipo + plaza (`20GP` + `PIURA`) | Pocas OC del uso |
| 5 | Tipo solo (`40HC`) | Esa plaza no tiene OC |
| 6 | **Promedio general** | El tipo no tiene ninguna OC de referencia (p. ej. 20OT, 45HC) |

El paso 6 es el promedio global que ya existía (todas las OC DRY). Si el admin cargó un monto en «Precio referencial DRY», ese monto **solo pisa el fallback global**, no las cubetas que sí tienen OC.

---

## 3. Casuística (quién usa qué)

| Unidad | ¿Tiene OC? | Base de costo |
|--------|------------|---------------|
| BMOU433548-9 · 40 HC · ZGROU · OC-0010009472 @ 1325 | Sí | **1325** (`fobCif`). El referencial no aplica. |
| APHU678930-9 · 40 HC segundo uso · ZGROU · Ajuste | No | Cubeta SKU `CDD40H0004` + `ZGROU` (promedio de esas OC; no el 1325 de una sola OC). |
| CBHU… · 20 DC segundo uso · Piura · Ajuste | No | Cubeta `20GP` + segundo uso + `PIURA`. Si no hay OC de ese uso en Piura → OC 20 DC segundo uso de otra plaza → promedio general. |
| CICU… · 20 DC nuevo · Piura · Ajuste | No | No usa el $300 de 20 DC usados de Piura. Busca `20GP` + nuevo (ZGROU u otra plaza). |
| CICU… · 20 DC nuevo · ZGROU · Ajuste | No | Cubeta `20GP` + nuevo + `ZGROU`. |
| Tipo raro (45HC, OT, FR) sin ninguna OC DRY de ese tipo | No | **Promedio general** (el `$1,288` de hoy, o el monto admin). |
| Fabricación (MO) sin costo de MO | No | Misma cascada sobre el SKU/tipo **terminado**. |

Después de esa base se suman los **extras** de almacén/proveedor ([caso_extra_almacenes.md](caso_extra_almacenes.md)). El promedio por plaza ya refleja lo que **sí** está en la OC; el extra es lo que Odoo no asoció.

---

## 4. Qué no hacer

- No promediar 20 y 40 juntos.
- No promediar nuevo y segundo uso juntos.
- No usar el patio Principal/Gambeta como dimensión de esta base.
- No escribir el referencial encima de `fobCif`.
- No usar un ajuste como muestra del promedio (circular).

---

## 5. UI / API

- `GET /config/dry-referential` y `GET /odoo-import/referential` devuelven `computed` (global), `effective` (fallback), `buckets[]` (cubetas con `n` y promedio) y `windowMonths`.
- Bandeja: «Ref. USD …» es el de **esa** cubeta, no el global (se indica si vino de SKU, tipo/plaza o promedio general).
- Configuración: se ve la matriz (tipo · uso · plaza · n · promedio). El monto admin sigue siendo el fallback global.
- Listas no manuales se recalculan al guardar extras o el referencial; `resolveAcquisition` usa la cubeta de la unidad.

**Estado:** implementado 2026-09-22. El fallback global es el promedio OC que ya existía.

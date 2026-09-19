# J1 extensión — Fabricación (MO): mismo serial, dos productos

Copia operativa. Canónica en Odoo: `zgroup/documentacion/fases/j1_fabricacion.md`.

Fecha: 19-sep-2026. Caso `LATU901117-1`. **Implementado.**

Tercera vía de origen, junto a **ajuste** y **compra (IN/OC)**.

## Qué se ve

Mismo serial, dos `stock.lot` (`date_sotck_move` desactiva unicidad de SN):

| Lote | Producto | A la mano |
|------|----------|-----------|
| 13035 | CDD40H0058 DRY 40 HC NUEVO | No — consumido en `ZGROU/MO/00292` |
| 17038 | CDND0081 DRY 40 HC NUEVO XL-LR | Sí — producido por esa MO |

Precursor: ajuste de inventario (31/05/2025). El lote a la mano se clasifica `fabrication`, no ajuste.

También este patrón: `LATU901121-1`, `LATU901133-5` (CDND0080 XL-R).

## Encaje

El lote a la mano **no** es ajuste ni OC. Es **fabricación**. El ajuste/OC es el **precursor** (otro `product_id`, a menudo off-hand).

No se crea segundo `Container`. Se recorre `stock.lot` por el mismo `name` aunque no esté a la mano.

Campos: `odooIntakeKind=fabrication`, `odooMoName`, `odooSourceLotId` / producto / origen precursor. Asimilar: `intakeType=fabricacion_odoo`, `costSource=mo`, FOB 0 (referencial del SKU terminado). Sin factura ZDRY.

## Hecho cuando

- [x] Badge **Fabricación** + MO.
- [x] Ficha precursor; no inventa OC.
- [x] Specs de classify / assimilate / own-sale / pricing.
- [x] Sync local: LATU901117-1 → MO/00292 precursor 13035 CDD40H0058 ajuste; 901121-1 → MO/00293; 901133-5 → MO/00294. 0 unknown.

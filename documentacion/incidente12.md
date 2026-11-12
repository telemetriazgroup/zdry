# Incidente 12 — dos lotes de la misma serie

**Fecha:** 2026-11-12

## Síntoma

CBHU414989 tenía dos lotes Odoo asimilados a la misma unidad. El lote viejo (Prime/Stock, ajuste, sin color, tara ni DUA) ya no tenía existencia. El lote vigente (Piura/Existencias) sí. En producción la unidad quedaba sin expediente y el lote en cero la marcaba como salida. En local, con un solo lote vigente, se veía disponible y con su expediente.

## Cambio

Si varios lotes comparten la serie y uno sigue con cantidad en una ubicación interna, ese lote manda. El lote viejo en cero, sin salida a cliente, no cierra la unidad, no borra el expediente y la ficha queda ligada al lote que Odoo todavía tiene en stock. Una salida hecha del lote que sí tiene cantidad sigue cerrando la serie.

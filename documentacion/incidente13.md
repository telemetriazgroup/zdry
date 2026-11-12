# Incidente 13 — salida vieja con el equipo otra vez a la mano

**Fecha:** 2026-11-12

## Síntoma

JXLU4028599 figuraba en Venta / en cliente. El expediente muestra dos despachos de mayo y, después, una entrada a ZGROU/Existencias y el traslado ZGROU/INT/00157 hacia Piura/Existencias. En Odoo la serie está a la mano, cantidad 1, en Piura/Existencias. ZDRY la dejaba cerrada por el despacho viejo.

## Cambio

La salida a cliente cierra la serie solo si después no volvió a una ubicación interna. Una entrada o un traslado posterior, aunque el origen no diga cliente, la devuelve a stock. Una reparación posterior no la reabre. Una salida hecha que no tiene un regreso posterior sigue cerrando, aunque el quant interno todavía figure en 1.

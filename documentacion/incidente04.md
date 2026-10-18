# Evolución 04 — el alquiler no es una venta

**Fecha:** 2026-10-17

## Síntoma

CAIU8532296 salió con la cotización 10020264231 y el módulo lo marcó como pérdida de USD 1,420. En Odoo ese pedido es un alquiler mensual de USD 120 (plan recurrente, asunto ALQUILER, línea de servicio 120 y el equipo asignado en USD 0). El contenedor vuelve al almacén cuando termina. Restar el costo del equipo convierte la cuota en una pérdida que no ocurrió.

## Causa

La salida tomaba la única línea con precio y la trataba como venta. La línea de alquiler dice «contenedor», así que no se descartaba como flete. No se leía si el pedido es suscripción ni quién es el comercial (`user_id`).

## Cambio

La cotización se clasifica al leerla. Es alquiler si tiene plan recurrente, suscripción, leasing o la palabra alquiler en el asunto o en las líneas. En ese caso se guarda la cuota y el comercial, y el resultado es la cuota: no se resta la base. La ficha dice que el equipo vuelve al almacén.

Los últimos 7 días cuentan las ventas aparte de los alquileres. Los comerciales de esas cotizaciones se ordenan por ventas de dry. El ritmo mensual repite esa semana cuatro veces. La ganancia y la pérdida del resumen son solo de ventas.

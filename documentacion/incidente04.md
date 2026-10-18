# Evolución 04 — el alquiler no es una venta

**Fecha:** 2026-10-17

## Síntoma

CAIU8532296 salió con la cotización 10020264231 y el módulo lo marcó como pérdida de USD 1,420. En Odoo ese pedido es un alquiler mensual de USD 120 (plan recurrente, asunto ALQUILER, línea de servicio 120 y el equipo asignado en USD 0). El contenedor vuelve al almacén cuando termina. Restar el costo del equipo convierte la cuota en una pérdida que no ocurrió.

## Causa

La salida tomaba la única línea con precio y la trataba como venta. La línea de alquiler dice «contenedor», así que no se descartaba como flete. No se leía si el pedido es suscripción ni quién es el comercial (`user_id`).

## Cambio

La cotización se clasifica al leerla. Es alquiler si tiene plan recurrente, suscripción, leasing o la palabra alquiler en el asunto o en las líneas. En ese caso se guarda la cuota y el comercial, y el resultado es la cuota: no se resta la base. La ficha dice que el equipo vuelve al almacén.

Si la línea de la serie está en precio 0, también es alquiler, aunque la cuota de al lado no diga la palabra. En 10020264094, MSKU0671529 está en USD 0 y el servicio en USD 120. Esos 120 son la cuota. No se restan de la base de USD 1,567 y no salen como pérdida de USD 1,447. Una serie con precio propio, como la venta anterior de USD 2,400, sigue siendo venta.

Si la cotización habla de módulos, el dry pasó por una transformación: sirvió de insumo para armar el módulo. En 10020252393, LATU9011211 está en USD 0 y las líneas de módulo suman USD 136,290. Eso no es la cuota de un alquiler ni la venta de ese dry. Solo se toma como venta la línea con precio distinto de 0 que traiga el código de ese equipo. Si no hay esa línea, queda como transformación y el costo no se resta.

Los últimos 7 días cuentan las ventas aparte de los alquileres. Los comerciales de esas cotizaciones se ordenan por ventas de dry. El ritmo mensual repite esa semana cuatro veces. La ganancia y la pérdida del resumen son solo de ventas.

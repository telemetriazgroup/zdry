# Evolución 05 — la hora del expediente es de Lima, no GMT

**Fecha:** 2026-10-18

## Síntoma

El movimiento se hizo a las 11:00 en el sistema (GMT−5) y el expediente lo mostraba a las 16:00. Odoo entrega la fecha-hora en GMT, sin zona, y la pantalla copiaba ese texto.

## Cambio

Al armar el expediente se restan 5 horas. Las 16:00 GMT quedan en 11:00. Una fecha sin hora, como el día de una factura, no se mueve. Lo guardado sigue siendo el dato de Odoo; solo cambia lo que se muestra.

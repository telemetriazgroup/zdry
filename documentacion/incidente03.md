# Evolución 03 — ventas realizadas con el precio de la unidad

**Fecha:** 2026-10-17

## Síntoma

EITU1457417 figura en Venta / en cliente con el pedido Odoo 10020263840, pero Evolución de salidas decía «Sin cotización ZDRY» y el expediente decía «Referencia, sin precio». En Odoo esa línea se vendió a precio unitario 1,790 con descuento 40 y neto 1,750. El mismo equipo tiene otra venta anterior (10020262130, 2026-06-03).

## Causa

Al detectar la salida, el expediente guardaba el pedido, pero el monto era el `amount_total` de toda la orden. Un pedido puede llevar varias unidades (10020263840 lleva al menos dos líneas de 1,750). La vista de despacho oculta esos montos a propósito. El cálculo de la salida solo miraba una cotización creada en ZDRY, y esta venta se cerró en Odoo.

## Cómo se agrupa

1. La salida (picking OUT a cliente) ya marca la serie como vendida y deja de publicarla.
2. En ese mismo recorrido se lee el pedido indicado en el origen del OUT, sus líneas y sus facturas. No se crean lotes nuevos.
3. De las líneas se queda la que trae el ISO en el equipo de studio, el lote o la descripción. El neto es el subtotal de esa línea. Si Odoo no manda subtotal, se aplica el descuento como porcentaje sobre el precio unitario.
4. Eso queda en el expediente de venta de esa serie: pedido, cliente, día, OUT, precio unitario, descuento, neto y factura. Si el mismo equipo se vendió más de una vez, cada pedido es una fila de su historial. La fila de la lista es la salida más reciente.
5. La ganancia o pérdida es ese neto menos la base de hoy (OC o ajuste + extras de almacén + margen de seguridad). Óptima cuando el neto está en el rango calculado, en el precio de inventario fijado a mano, o por encima. Por debajo no es óptima.
6. Los últimos 7 días cuentan ventas o salidas cuya fecha cae en esa ventana.

El módulo **Ventas realizadas** (menú y pestaña de Recepción) es para admin y superadmin. «Completar precios y facturas» vuelve a leer Odoo solo de las series que ya salieron.

## Límite

La base de costo es la de la ficha hoy, no una foto congelada el día de la venta. El precio vendido sí queda guardado por pedido. Producción no se publicó con este cambio.

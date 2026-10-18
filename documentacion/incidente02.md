# Evolución 02 — extras para todas las plazas, auditoría del admin y salidas

**Fecha:** 2026-10-17

## Extras de costo

Un concepto de almacén Odoo se repetía una vez por plaza (Piura y ZGROU / Callao) cuando el monto era el mismo. El destino **Todos** (`TODOS`) aplica ese extra en cada plaza que tenga código. No entra si la unidad no tiene plaza. Una regla de una plaza concreta sigue sumándose aparte.

## Auditoría para el admin

El admin ve el mismo registro de acciones que el superadmin, sin las acciones hechas por el superadmin. La suplantación queda a nombre del superadmin, así que tampoco aparece.

## Comerciales

Apartado para admin y superadmin: accesos de cada comercial, clientes registrados en enlaces, cuántos de esos clientes abrieron el catálogo y qué unidades vieron más.

## Salidas

En Recepción → Venta / en cliente, admin y superadmin tienen **Evolución de salidas**. Usa datos ya guardados y vinculados a Odoo:

- origen: OC (`odooPoName`) o ajuste / fabricación
- base: costo de origen + extras de almacén/proveedor + margen de seguridad
- cotización ZDRY de esa serie: venta o alquiler, responsable, cliente, precio cerrado
- pedido y factura Odoo de esa cotización (`odooSaleName`, `odooInvoiceName`)
- si no hay cotización ZDRY, el pedido del expediente Odoo si ya se sincronizó

La venta se compara con el rango calculado. Si el precio de inventario se fijó a mano, se compara contra ese precio. La ganancia de una venta es el cierre menos la base. El alquiler muestra el ingreso del contrato y no resta el costo del equipo.

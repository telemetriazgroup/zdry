# Estado comercial

Qué hace hoy cada rol comercial en ZDRY. El código manda: `vendedor` y `ejecutivo` en `apps/web/src/auth.jsx`.

Ninguno de los dos ve el costo real (FOB ni C_T). Ven precio de lista, mínimo y margen.

## Vendedor / Comercial

Atiende a sus clientes. El enlace de catálogo que genera queda a su nombre.

- **Inventario.** Unidades publicadas, con precio de lista, mínimo y margen. Puede pedir un precio bajo el mínimo; lo aprueba administración.
- **Patio.** Vista 3D de los patios que tienen equipos en un puesto. Ubica un contenedor, ve su posición y abre la ficha con fotos. No traslada, no cambia zonas, no despacha y no carga fotos.
- **Prepublicados.** Equipos con fotos y sin puesto definido. Mismo precio de lista, mínimo y margen que los publicados. Despacho todavía no les asignó posición. Cuando el puesto queda confirmado, pasan al catálogo publicado.
- **Enlaces de catálogo.** Ve y administra los suyos. Con RUC, el contacto se crea en Odoo al generar el enlace. Solo con DNI, los datos quedan en ZDRY y no se crea el contacto en Odoo; el RUC queda pendiente para agregarlo antes de cotizar.
- **Catálogo en modo comercial.** Lista, mínimo y margen. El cliente no ve esos números.

No ve la actividad de los demás vendedores ni asigna un enlace a otro comercial.

## Ejecutivo comercial

Hace la misma operación que el vendedor: inventario, patio en solo lectura, prepublicados y catálogo con precio y margen.

Además coordina al equipo:

- **Enlaces de catálogo.** Ve los enlaces de todos los vendedores. Al generar uno, elige qué vendedor hace el seguimiento.
- **Comerciales.** Ve accesos, clientes registrados en enlaces y las unidades que esos clientes abrieron.

Tampoco crea un contacto en Odoo cuando el cliente queda solo con DNI. El alta con RUC sigue el mismo proceso que el del vendedor.

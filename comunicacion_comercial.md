# Comunicación comercial

Contrato de la comunicación comercial. El módulo Equipo comercial, los tres avisos del registro y el hilo de precio siguen este texto.

La cotización en Odoo sigue siendo el paso siguiente. Aquí el comercial recibe el pedido y el cliente recibe el aviso de que se está revisando. No se crea la orden de venta ni la de alquiler.

## Qué hay hoy

El registro de portería (`publicRegister` en `catalog-shares.service.ts`) elige al vendedor activo con menos enlaces de origen cliente (`assignWalkInVendor`). No hay ejecutivo de seguimiento ni lista de vendedores habilitados.

`queueShareAvisos` avisa al cliente y a ese vendedor por `SalidaService`. El ejecutivo no entra. SGIT recibe un WhatsApp (`telefono`, `mensaje`, `contacto`) y, si corresponde, un correo. Varios destinos pueden ir en la misma llamada, hasta 30 WhatsApp y 30 correos (`conexion_api_was_correo.md`).

Si el cliente pide un equipo, `requestUnit` guarda un evento `interest` y avisa solo al vendedor. El mensaje al cliente es fijo: «Tu cotización ha sido solicitada». No hay precio elegido por el comercial, ni opciones, ni reloj de seguimiento.

Quien escribe al WhatsApp de SGIT y no es usuario de SGIT solo recibe: «Para continuar, comunícate al {contacto}». SGIT no devuelve esa respuesta a ZDRY. Por eso el hilo de opciones vive en ZDRY. WhatsApp y correo avisan y llevan al hilo. Para contestar 1, 2, 3 u OK desde el propio WhatsApp hace falta el cambio de SGIT del apartado siguiente.

El rango de precio ya existe: mínimo `priceMin`, máximo `priceList`. El IGV es 18 % (`igvOf` y `grossOf` en `domain/pricing.ts`). Un DNI nuevo no crea contacto en Odoo. Un RUC sí.

## Módulo de asignación

Pantalla nueva, **Equipo comercial**, para superadmin y administrador. El ejecutivo ve solo su equipo.

Cada fila es un vendedor habilitado para recibir clientes del formulario de registro:

| Dato | Regla |
|---|---|
| Vendedor | Usuario con rol `vendedor`, activo, con WhatsApp de 8 a 15 dígitos |
| Ejecutivo de seguimiento | Usuario con rol `ejecutivo`, activo, con WhatsApp |
| Habilitado | Si está apagado, el registro no se lo asigna |

Un vendedor tiene un solo ejecutivo. Un ejecutivo puede seguir a varios vendedores. Sin WhatsApp del vendedor o del ejecutivo, la fila no se puede habilitar.

La asignación del formulario deja de usar a todos los vendedores activos. Toma solo los habilitados y reparte por carga: el que tenga menos registros de origen cliente. Si no hay ninguno habilitado, el formulario responde que no hay un comercial disponible y no abre el enlace.

El enlace guarda, además del vendedor, el ejecutivo que en ese momento le hace seguimiento. Si después se cambia el ejecutivo de la fila, los enlaces ya abiertos conservan al ejecutivo con el que nacieron.

## Registro con DNI o con RUC

Igual para los dos documentos. El DNI sigue guardado solo en ZDRY. El RUC sigue creando el contacto en Odoo.

Al quedar el enlace, ZDRY manda **un solo POST** a `POST /SGIT/salida` con tres WhatsApp y los correos que existan:

1. **Cliente**, a su celular y a su correo. Lleva el saludo, el enlace del catálogo, la clave, la vigencia y el nombre del vendedor. El `contacto` de ese WhatsApp es el celular del vendedor.
2. **Vendedor**, a su WhatsApp y a su correo. Lleva que tiene un cliente por atender: nombre, empresa o persona, DNI o RUC, celular, correo, y el enlace interno del hilo.
3. **Ejecutivo**, a su WhatsApp y a su correo. Lleva que uno de sus vendedores quedó con un cliente: nombre del vendedor, datos del cliente y el mismo hilo, para ver si lo atiende a tiempo.

Los tres textos son distintos. No se reenvía el mismo mensaje a los tres números.

Hoy, si un número todavía tiene un WhatsApp sin salir, SGIT responde `en_espera` y no guarda el nuevo. ZDRY ya espera 5 segundos entre avisos del mismo flujo y puede reintentar. Los tres números son distintos, así que caben en la misma llamada. Un reintento posterior, número por número, cubre el `en_espera`.

## Cambio en SGIT

Para los tres avisos, la ruta actual alcanza: `whatsapp` como lista de tres objetos `{ telefono, mensaje, contacto }` y `correo` como lista. No hace falta una ruta nueva solo para «recibir tres números».

Para el chat, SGIT tiene que dejar de tragarse la respuesta de estos hilos. Cada WhatsApp de este flujo lleva un campo nuevo:

| Campo | Uso |
|---|---|
| `referencia` | Id del hilo en ZDRY. SGIT lo guarda y lo devuelve |
| `respuestaUrl` | URL de ZDRY que recibe la contestación |

Cuando la persona escribe al bot y el último mensaje saliente de ese número tiene `referencia`, SGIT hace `POST` a `respuestaUrl` con:

```json
{
  "referencia": "id-del-hilo",
  "telefono": "51987654321",
  "texto": "1"
}
```

y no responde «comunícate al contacto». El texto aceptado en esa vuelta es `1`, `2`, `3` u `OK` (sin distinguir mayúsculas). Cualquier otro texto lo reenvía ZDRY al hilo como mensaje libre, y SGIT le contesta con las opciones vigentes que ZDRY le indique en la respuesta de ese POST.

ZDRY contesta el POST de SGIT con el siguiente WhatsApp a enviar, o con vacío si no hay que decir nada. Así el bot no inventa el menú.

Sin `referencia`, el comportamiento actual se mantiene.

## Hilo mientras el cliente mira el catálogo

Al pedir precio o información de un equipo se abre un hilo de ese enlace y ese ISO. Si ya hay uno abierto para el mismo equipo, se sigue ese.

Entran el cliente, su vendedor y el ejecutivo de ese enlace. ZDRY avisa por WhatsApp al vendedor y al ejecutivo: cliente, equipo, precio de lista, mínimo y margen. El precio que ve el comercial es el neto de venta, no el costo.

El menú del comercial, en ZDRY, ofrece:

1. **Precio de lista**, el máximo permitido. Es la opción sugerida.
2. **Otro precio**, un neto entre el mínimo y la lista. Fuera de ese rango no se envía.

Al confirmar, el cliente recibe en el hilo, y por WhatsApp y correo, un saludo con el equipo y el precio:

- neto elegido
- IGV 18 %
- total con IGV

Y tres opciones:

1. Solicitar cotización
2. Que me contacte el comercial
3. Entendido, gracias

Esas opciones se contestan en el hilo de ZDRY. Si SGIT ya devuelve la respuesta, el `1`, `2` o `3` escrito por WhatsApp entra al mismo hilo.

### Opción 1 — Solicitar cotización

El cliente ve de inmediato: «El comercial está revisando tu solicitud y te entrega la cotización en un momento».

Al vendedor le llega WhatsApp y correo: el cliente pidió la cotización de ese equipo a ese precio (neto, IGV y total). El ejecutivo ve el mismo hecho en el hilo. La orden en Odoo no se crea en este paso.

### Opción 2 — Que me contacte el comercial

Al vendedor le llega WhatsApp y correo: el cliente quiere que lo contacten, con teléfono, correo, equipo y precio. Tiene que responder **OK** en el hilo (o `OK` por WhatsApp cuando SGIT devuelva la respuesta).

Si no hay OK, ZDRY vuelve a avisarle cada **5 minutos** mientras el hilo siga en espera de contacto. Cada reintento respeta la cola de SGIT: si el anterior sigue `en_espera`, se intenta de nuevo en el siguiente ciclo, no se acumulan mensajes.

A los **15 minutos** sin OK, ZDRY avisa al ejecutivo por WhatsApp y correo: el vendedor no confirmó la comunicación, puede llamar él si quiere, y el mensaje trae los datos del cliente y el contenedor del que pidió referencia. El ejecutivo también lo ve en el hilo.

### Opción 3 — Entendido, gracias

El hilo queda cerrado. Se agradece en el hilo. No hay reloj ni aviso de urgencia.

## Qué hay que construir en ZDRY

- Tabla del equipo comercial: vendedor, ejecutivo, habilitado.
- Pantalla Equipo comercial y el cambio de `assignWalkInVendor` para usar solo esa lista y guardar el ejecutivo en el enlace.
- El POST de registro con los tres destinos, y el reintento de `en_espera`.
- Hilo por enlace e ISO: mensajes, precio ofrecido, estado (`abierto`, `esperando_contacto`, `cotizacion_pedida`, `cerrado`) y la hora del último OK.
- Menú del comercial con el máximo y el precio dentro del rango. Cálculo de IGV con `igvOf` / `grossOf`.
- Opciones 1, 2 y 3 en el catálogo del cliente.
- Reloj interno: cada 5 minutos el recordatorio al vendedor; a los 15, el aviso al ejecutivo. No depende de que el cliente siga en la página.
- Bandeja del vendedor y del ejecutivo con sus hilos abiertos.

## Qué queda fuera

Crear la cotización de venta o de alquiler en Odoo cuando el cliente elige la opción 1. El aviso y el hilo sí quedan. La orden es el paso siguiente del sistema.

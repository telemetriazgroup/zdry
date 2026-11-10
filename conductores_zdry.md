# Registro de conductores

Especificación para adaptar el módulo de visitas al control de ingreso «REGISTRO DE CONDUCTORES». El módulo atiende dry, refrigerados y otros equipos. El código de equipo se guarda tal como lo escribe el conductor.

Las decisiones de este documento están cerradas. El único pendiente externo es la ruta de SGIT descrita en `caso_registro_transporte.md`: el correo interno debe salir con cuerpo HTML. WhatsApp sigue en texto.

## Qué queda al registrar

El conductor se inscribe en el formulario público, con la marca ZGROUP y el título «Registro de conductores / Control de ingreso». Al enviar:

- el ingreso queda en **REGISTRADO**;
- el código visible es `ZG-AAAAMMDD-HHMMSS` (ejemplo `ZG-20261110-095608`);
- el conductor recibe en pantalla el comprobante con código QR y puede descargar el PDF;
- la foto de la unidad sigue siendo opcional;
- operaciones recibe el aviso por correo y por WhatsApp, solo a las listas de esa sede.

El conductor no recibe WhatsApp en ese momento. El PDF es su comprobante. El WhatsApp al teléfono del conductor sale después, cuando el coordinador de despacho elige enviarlo.

## Lo que hay hoy y qué cambia

La visita pública está en `/visita` (`VisitaPublica`) y el panel en `/app/almacen/visitas` (`Visitas`). El dato es `GateVisit`.

Hoy el formulario pide placa de tracto, empresa, RUC, conductor, fecha de visita, brevete, motivo, placa de carreta, teléfono y código de equipo. El motivo solo acepta `cargar` y `descargar`. No hay sede, observaciones ni estado de atención. La lógica actual se modifica para usar los campos del formulario y del Excel.

Al guardar se genera un `publicToken`. Con ese token se arma el QR y el PDF (`visit-ticket.js`). Ese comprobante se mantiene. El id visible pasa a ser el `ZG-`.

La foto hoy queda en `pending` hasta que un admin o coordinador la aprueba o la rechaza, y en patio de campo solo se muestra aprobada. Eso se retira. Con la foto cargada, el vigilante la ve. El rol vigilante es `almacen`.

Hoy, vincular un contenedor (`containerIso`) bloquea la edición pública. Esa regla se reemplaza: el enlace externo puede corregir el ingreso mientras el estado es REGISTRADO. Al pasar a otro estado, el enlace externo queda solo de lectura y sigue mostrando el PDF.

Archivar la visita (`archivedAt`) saca el registro del listado activo. Archivar la foto es otra acción: oculta la imagen y conserva el archivo.

Los avisos de los enlaces de catálogo siguen por `POST https://ztrack.app/servicio/salida` con `x-salida-clave`. Cada llamada lleva un teléfono y un correo. El canal de los enlaces (ambos, solo correo, solo WhatsApp o ninguno) no se mezcla con las listas de este módulo. El correo de este módulo pide cuerpo HTML; el contrato de esa ruta está en `caso_registro_transporte.md`. La ruta actual documenta `cuerpo` como texto plano.

## Formulario público

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| Sede | sí | Lima y Piura de inicio. El menú agrega más. |
| Empresa | sí | |
| RUC | sí | 11 dígitos en un ingreso nuevo |
| Nombres y apellidos | sí | |
| N.º de brevete | sí | |
| Teléfono | sí | 9 dígitos |
| Placa tracto | sí | |
| Placa carreta | sí | |
| Motivo de visita | sí | lista administrable |
| Código de equipo | no | se guarda tal cual |
| Observaciones | no | |
| Foto de la unidad | no | |

Lima, Piura y estos motivos entran como datos iniciales:

- Cargar contenedor
- Descargar contenedor
- Mantenimiento o reparación
- Almacenaje
- Otros

Si el motivo es Otros, el formulario pide el detalle. En el histórico ese detalle ya viene pegado al motivo (`OTROS - RECOJO DE UN TRANSFORMADOR`) y se conserva así.

El enlace externo, identificado por el token del QR, puede corregir los datos mientras el estado sigue en REGISTRADO. Cuando el coordinador lo pasa a EN ATENCIÓN, FINALIZADO o CANCELADO, ese enlace ya no modifica el ingreso. El QR sigue abriendo el comprobante y el PDF.

## Código de equipo

El formulario no propone un ISO ni busca un contenedor en ZDRY. El valor que escribe el conductor se guarda igual, sea un dry, un refrigerado u otro equipo.

Si el texto, ya sin espacios y en mayúsculas, no cumple la forma ISO (cuatro letras y siete dígitos), el panel muestra la advertencia «no cumple la norma ISO». El ingreso se guarda igual. El coordinador puede corregir el código desde el panel. Corregirlo no dispara un enlace automático al catálogo.

## Sedes, correos y WhatsApp internos

La lista inicial de Lima es correcta y se puede editar: agregar o quitar correos y números sin un despliegue.

Correos iniciales de Lima:

- `asistente_operaciones@zgroup.com.pe`
- `operaciones@zgroup.com.pe`
- `mzabarburu@zgroup.com.pe`

Lima no trae números de WhatsApp internos. Se agregan en el mismo menú.

Piura existe como sede y nace sin correos ni números. Una sede creada después también nace vacía. Cada sede tiene sus propias listas. Publicar la sede en el formulario no exige tener destinos: si la lista está vacía, el ingreso se guarda, el conductor recibe el PDF y el panel indica que esa sede no tiene avisos configurados.

Cada ítem de la lista tiene destino, nombre corto y activo o inactivo. Desactivar no borra el historial de envíos. El número de respuesta de la sede (`contacto` que exige SGIT en cada WhatsApp) también se configura ahí. Si falta, ese WhatsApp no sale y el panel lo dice.

## Avisos

El aviso automático, correo y WhatsApp, sale una sola vez: cuando el conductor se registra por el enlace público. Lo reciben las listas activas de esa sede. El conductor no está en esas listas.

Si un destino falla, el ingreso queda REGISTRADO y el panel muestra cuál falló. El coordinador puede reenviar solo ese destino. Cambiar el estado no vuelve a avisar a operaciones.

El asunto del correo es el de la ficha actual: `[LIMA] CARGAR CONTENEDOR | CYB.476`. El cuerpo HTML es la ficha «Nuevo registro de conductor»: sede, motivo, fecha y hora, placas, conductor, empresa, RUC, brevete, teléfono, código de equipo, estado, observaciones e id `ZG-`. El texto plano lleva los mismos datos, para el caso en que el cliente de correo no muestre HTML. El nombre visible pedido a SGIT es «Registro de Conductores - ZGROUP».

El WhatsApp interno lleva el mismo contenido en texto, porque ese canal no acepta la ficha HTML.

SGIT acepta hasta 30 WhatsApp y 30 correos por llamada. Una inscripción manda una llamada con las listas de la sede. El resultado de cada destino queda guardado.

## Mensajes al conductor

Los manda el coordinador, al teléfono de 9 dígitos del ingreso. Hay dos textos. Se envía uno u otro, nunca los dos a la vez por la misma acción.

**Confirmación.** Plantilla editable, con este texto inicial:

```
Hola, *{conductor}*.

Su registro para *{motivo}* ha sido recibido.
En breve nos pondremos en contacto contigo.

Saludos.
```

**Ubicación.** El coordinador elige un almacén. En Lima son Gambeta 1 o Gambeta 2. Sale uno solo. La plantilla se replica para otro almacén: cambian el nombre y el enlace de Google Maps.

```
Hola, *{conductor}*.

Puede dirigirse a nuestro almacén *{almacen}* para *{motivo}*.

*Ubicación:* {mapa}

Saludos.
```

| Almacén | Enlace inicial |
| --- | --- |
| Gambeta 1 | `https://maps.app.goo.gl/LaQNc1TTT3Svk6bYA` |
| Gambeta 2 | `https://maps.app.goo.gl/ZqawyDSRAunNbde5A?g_st=ipc` |

`{conductor}` es el nombre del ingreso. `{motivo}` es el motivo guardado. `{almacen}` y `{mapa}` salen del almacén elegido. Los asteriscos se mantienen: WhatsApp los muestra en negrita.

Piura y cualquier sede nueva nacen sin almacenes de este tipo. El menú agrega puntos con la misma estructura: nombre, enlace de mapa y la plantilla de arriba.

Al pasar a EN ATENCIÓN, el coordinador decide si envía la confirmación al conductor en ese momento. Si no la envía, el ingreso cambia de estado igual. Más adelante, desde la ficha, puede enviar la confirmación o la ubicación. Esas acciones no avisan a la lista interna.

## Estados

| Estado | Uso |
| --- | --- |
| REGISTRADO | al crear el ingreso. El enlace externo todavía puede corregirlo. |
| EN ATENCIÓN | operaciones toma el camión. Ahí se puede enviar la confirmación al conductor, o dejarla para después. |
| FINALIZADO | el ingreso terminó |
| CANCELADO | no se atiende |

El cambio guarda usuario, hora y estado anterior. El conductor no cambia el estado.

El histórico trae además **ANULADO** (7 filas en Lima). Esas filas se importan con ese estado. El menú de un ingreso nuevo ofrece los cuatro estados de la tabla. Una fila importada como ANULADO se muestra así hasta que alguien la pase a uno de los cuatro.

## Foto

La foto es opcional y la sube el conductor en el mismo envío.

El vigilante (`almacen`) la ve en cuanto existe, en la ficha y en portería, sin aprobación. Si el ingreso llega a verse en patio de campo, la foto también se muestra ahí sin visto bueno.

El coordinador de despacho puede archivarla. Desde ese momento no se muestra al vigilante, en portería, en patio ni en un PDF nuevo. El archivo se conserva, con fecha y usuario. Desarchivarla queda en `admin` y `superadmin`. El coordinador no la vuelve a mostrar. Rechazar la foto sale de este flujo.

Archivar la foto no archiva el ingreso. Archivar el ingreso lo saca del tablero activo.

## Carga del Excel

El archivo `REGISTRO DE CONDUCTORES (1).xlsx` es la regla de los datos. El módulo toma sus columnas, no al revés.

**REGISTROS** (Lima): 368 filas con id `ZG-`, del `ZG-20260914-142015` al `ZG-20261110-155450`.

| Columna | Contenido |
| --- | --- |
| ID | `ZG-AAAAMMDD-HHMMSS` |
| FECHA | serial de Excel |
| HORA | fracción del día |
| EMPRESA, RUC, CONDUCTOR, BREVETE, TELEFONO | |
| PLACA DE TRACTO, PLACA DE CARRETA | |
| MOTIVO DE VISITA | texto de la celda |
| CODIGO DE EQUIPO | 191 filas lo traen, tal cual |
| ESTADO | 351 FINALIZADO, 10 CANCELADO, 7 ANULADO |
| OBSERVACIONES | 116 filas |
| MENSAJE DE CONFIRMACION, UBICACION GAMB 1, UBICACION GAMB 2 | botones de la hoja. El texto que se envía es el de las plantillas de este documento |

Motivos en Lima: Cargar contenedor 161, Descargar contenedor 128, Otros 38, Descargar 12, Mantenimiento o reparación 10, Cargar 6, Almacenaje 6, Mantenimiento 3, y cuatro «Otros» con detalle. Esos textos se guardan como están. Los cinco motivos del formulario son el menú de un ingreso nuevo.

**PIURA**: el mismo encabezado y una fila (`ZG-20261110-082945`, Cargar contenedor, FINALIZADO).

Reglas de la carga:

- REGISTROS entra como Lima; PIURA como Piura;
- un `ZG-` que ya existe no se duplica; la carga informa y solo completa campos vacíos;
- RUC y teléfono vienen como número. Se leen como texto de dígitos. Un RUC histórico corto, como el de Ransa, se guarda con los dígitos que trae. Un ingreso nuevo sigue pidiendo 11;
- fecha y hora salen del serial, en hora de Lima;
- el código de equipo se copia tal cual y, si no cumple ISO, queda la misma advertencia del panel;
- no se envía correo ni WhatsApp;
- no hay foto que importar;
- el resultado muestra altas, ya existentes, filas omitidas y el motivo de cada omisión.

## Qué construir

1. Maestros de sedes y motivos. Lima, Piura y los cinco motivos quedan sembrados. Una sede nueva nace sin listas y sin almacenes.
2. Listas editables de correo y WhatsApp por sede, más el número de respuesta. Lima nace con los tres correos.
3. Almacenes con plantilla y enlace de mapa. Lima nace con Gambeta 1 y Gambeta 2. La acción de la ficha envía uno.
4. Plantilla de confirmación al conductor, con el texto de arriba.
5. Formulario público con los campos de la tabla, validación de RUC, teléfono y placas, y foto opcional.
6. Id `ZG-` único, además del token del QR. El PDF usa ese id y la sede. Si la foto está archivada, el PDF nuevo no la incluye.
7. Estado, historial, y cierre del enlace externo al salir de REGISTRADO.
8. Aviso interno solo al registrar, por la ruta de `caso_registro_transporte.md`, con resultado por destino y reenvío del que falló.
9. En EN ATENCIÓN, la opción de enviar o no la confirmación al conductor. Después, los botones de confirmación y de un almacén.
10. Advertencia ISO en el código de equipo, sin bloquear y sin proponer otro código. El coordinador puede editarlo.
11. Foto visible para `almacen`. La archiva el coordinador. La desarchivan `admin` y `superadmin`.
12. Carga del xlsx con el reporte, sin mensajes.

Patio, catálogo, enlaces comerciales y la configuración global de salida de esos enlaces siguen igual.

## Orden de desarrollo

1. Datos: sede, motivo, estado, id `ZG-`, observaciones, listas, plantillas y almacenes. La foto pasa a verse sin aprobación y gana archivo propio.
2. Formulario público, QR y PDF.
3. Panel del coordinador: tablero, cambio de estado, edición del código, archivo de foto.
4. Aviso interno al registrar, y los botones al conductor.
5. Vista del vigilante (`almacen`), con la foto visible.
6. Carga del Excel, sin disparar mensajes.

Hasta que SGIT publique la ruta HTML, el ingreso se guarda y el correo interno espera. WhatsApp puede salir por la ruta actual, que ya acepta texto.

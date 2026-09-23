# Cuenta API de Odoo por usuario

Hoy ZDRY habla con Odoo con una sola cuenta. La URL, la base, el usuario y la clave viven en la configuración del servidor (`ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY`) y, si el superadmin las guarda, en el ajuste `odoo_config`. `OdooClient` autentica esa cuenta en cada lectura y cada escritura (`authenticate` → `execute_kw`). En Odoo, `create_uid` y `write_uid` quedan siempre en esa persona. El chatter, el historial y los permisos son los de esa cuenta, no los de quien hizo clic en ZDRY.

El objetivo es que comercial, despacho y administrador entren a Odoo con su propia clave. Odoo registra la operación a su nombre. Quien no tenga la conexión probada no ve ni cambia la información que sale de Odoo. El superadmin puede eximir a alguien para que siga operando con la cuenta principal.

## Qué queda fijo y qué pone cada persona

Fijo para cada persona, y solo el superadmin lo cambia (ver el corte de pruebas a producción):

- URL de Odoo
- Nombre de la base de datos

Lo pone cada usuario, atado a su correo de ZDRY:

- Correo (debe ser el login de su usuario en Odoo)
- Clave API generada en Odoo
- Un test que ZDRY ejecuta contra esa URL y esa base

La cuenta principal no desaparece. Sigue sirviendo para la sincronización de fondo (bajar lotes, marcar eventos `zdry.sync.event`, trabajos sin una persona delante) y para quien el superadmin exima.

## Cómo Odoo sabe quién operó

Odoo no acepta un encabezado de “hazlo en nombre de fulano” en el JSON-RPC que usa ZDRY. El usuario de la operación es el `uid` que devuelve `authenticate(db, login, apiKey)`. Ese `uid` es el que Odoo graba en `create_uid`, `write_uid` y en el mensaje del chatter.

Por eso no basta con guardar el nombre del usuario de ZDRY en una nota. La llamada tiene que autenticarse con la clave de esa persona. Si se usa la cuenta principal, Odoo seguirá viendo a la cuenta principal, aunque ZDRY sepa quién hizo clic.

El test de conexión debe comprobar tres cosas, no solo que la clave abre sesión:

1. `authenticate` devuelve un `uid`.
2. El `login` de ese `res.users` es el mismo correo de ZDRY (sin distinguir mayúsculas).
3. Ese usuario de Odoo puede hacer lo que su rol de ZDRY necesita (lectura de lote, y escritura si el rol escribe). Un comercial puede autenticar y aun así recibir `AccessError` al confirmar un pedido si en Odoo no está en el grupo correcto.

Si el correo de ZDRY no es el login de Odoo, el test falla y la puerta sigue cerrada. No se acepta “cualquier clave válida de otra persona”.

## Puerta en ZDRY

Roles que deben vincularse: comercial (`vendedor`), despacho (`coordinador`) y administrador (`admin`).

Estados de la vinculación:

| Estado | Qué significa |
|---|---|
| Sin vínculo | Nunca probó, o cambió la URL o la base |
| Activa | El último test coincidió con su correo y los permisos de su rol |
| Fallida | La clave fue rechazada, el correo no coincide, o Odoo negó el permiso |
| Exenta | El superadmin autorizó usar la cuenta principal |

Sin estado Activa o Exenta, ZDRY no muestra ni deja editar la información que viene de Odoo. Puede seguir entrando al sistema y usar lo que es solo de ZDRY (patio, visitas de puerta, fotos cargadas en ZDRY, su perfil).

Información que queda detrás de la puerta:

- Bandeja y ficha Odoo, expediente, fotos y notas traídas de Odoo
- Costos de OC, proveedor, procedencia y plaza cuando el origen es Odoo
- Regularización, corrección de ficha que escribe en Odoo, conciliación de reentrega
- Emisión y cierre de cotización o alquiler hacia Odoo
- Estadística DRY leída en vivo de Odoo

Lo que ya está copiado en la base de ZDRY no debe seguir visible en esas pantallas solo porque se sincronizó antes. Si el usuario no está activo, esas columnas y paneles salen vacíos o con el aviso de conexión, no con el dato cacheado.

Compras y gerencia hoy también tocan datos de Odoo (deuda, conciliación, reglas). Esta primera puerta no los incluye. Hay que decidir si compras entra en la misma regla antes de construir, porque si no, sus escrituras seguirían saliendo a nombre de la cuenta principal.

## Modal cada 5 minutos

Si el usuario es de esos tres roles, no está activo y no está exento, ZDRY muestra un modal con los pasos para obtener la clave. Vuelve a aparecer cada 5 minutos mientras la sesión siga abierta y el vínculo no esté activo. Cerrar el modal no activa la cuenta; solo lo pospone.

El modal explica, en este orden:

1. La URL y la base ya están puestas. No se cambian.
2. En Odoo, con su usuario: Preferencias → Seguridad de la cuenta → Nueva clave API.
3. En ZDRY pega su correo y esa clave y pulsa Probar.
4. Si el test pasa, el modal deja de salir y se abren las funciones de su rol.

El aviso no sale para el superadmin, para un usuario exento, ni para roles que no están en la puerta (almacén, cliente).

## Exención del superadmin

El superadmin ve la lista de usuarios y puede marcar “operar con la cuenta principal”. Esa persona entra a las pantallas de Odoo sin clave propia. Las escrituras salen con el `uid` de la cuenta principal.

Eso tiene que quedar escrito en la auditoría de ZDRY: quién estaba exento, quién hizo clic y que Odoo no verá su nombre. Si no, el historial de Odoo y el de ZDRY se contradicen y nadie lo nota.

Quitar la exención cierra la puerta al momento. La próxima acción de Odoo exige la clave personal.

El superadmin no se bloquea a sí mismo: administra la cuenta principal y puede probarla desde Integración Odoo, como ahora.

## Cómo construirlo

1. **Dato por usuario.** Una fila por usuario: correo Odoo, `uid`, nombre leído en el test, clave cifrada, estado, fecha del test, último error, marca de exención y quién la puso. La clave no se guarda en claro ni se devuelve al navegador. Al leer, solo “hay clave” y el resultado del test.

2. **Cifrado.** La clave se cifra con un secreto del servidor, distinto de la base. Si se rota ese secreto, hay que volver a pedir las claves. El mismo criterio debería aplicarse después a la clave principal, que hoy puede quedar en el ajuste `odoo_config`.

3. **Cliente Odoo con actor.** `OdooClient` deja de usar siempre `readConfig()`. Cada llamada recibe al usuario de ZDRY que la provoca. Si está exento o es un trabajo de sistema, usa la cuenta principal. Si no tiene vínculo activo, la llamada no sale y la API responde que falta la conexión. El `uid` se recuerda unos minutos por usuario; si Odoo rechaza la clave, se olvida y el estado pasa a Fallida.

4. **Test.** El usuario envía correo y clave. ZDRY autentica contra la URL y la base fijas, lee `login`, `name` y `company_id`, y prueba un `search_read` corto del modelo que su rol necesita. Si algo falla, no se marca Activa y se guarda el motivo sin guardar la clave rechazada en el log.

5. **Pantallas.** En el perfil, el formulario de correo, clave y Probar, con URL y base solo de lectura. El modal de los 5 minutos usa el mismo formulario. En Integración Odoo, el superadmin sigue editando URL, base y cuenta principal, y además la lista de exenciones.

6. **Invalidar.** Si el superadmin cambia la URL o la base, todos los vínculos activos vuelven a Sin vínculo. La clave de la Odoo de pruebas no sirve en la de producción. El corte completo está más abajo.

7. **Trabajos en segundo plano.** La bajada de lotes, el acuse de `zdry.sync.event` y cualquier cola sin una persona en pantalla siguen con la cuenta principal. Un trabajo disparado por alguien (emitir cotización, cerrar venta, escribir la ficha) usa la clave de quien lo disparó. Si esa clave caducó, el trabajo falla y se avisa; no se reintenta en silencio con la cuenta principal, salvo que esa persona esté exenta.

8. **Suplantación.** Si el superadmin entra como otro usuario, las llamadas usan la clave o la exención de ese usuario, no la del superadmin.

## Desafíos

**El login de Odoo no siempre es el correo.** En muchas bases el login es un usuario corto. El test exige que coincida con el correo de ZDRY. Si no coinciden, o se cambia el login en Odoo o no hay puerta. No conviene un mapa libre “este correo es aquel login” en la primera versión: alguien podría pegar la clave de otra persona.

**Permisos distintos en Odoo.** Autenticar no implica poder escribir `stock.lot`, `sale.order` o `stock.picking`. El test tiene que ser por rol. Aun así, un permiso fino puede fallar después (un almacén, una compañía). Ese error debe verse como fallo de Odoo, volver a mostrar el estado y no dejar la pantalla en blanco.

**Compañía.** El `uid` opera en la compañía de ese usuario. Si la cuenta principal está en otra compañía, los pedidos y los lotes pueden no coincidir. El test debe mostrar la compañía leída y rechazar si no es la de trabajo.

**Datos ya copiados.** Inventario, ficha y expediente guardan en Postgres lo que se bajó con la cuenta principal. Cerrar solo la llamada en vivo deja el dato a la vista. La puerta tiene que ocultar esos campos, no solo desactivar el botón.

**La cuenta principal sigue siendo necesaria.** Sin ella no hay sincronización de lotes ni acuse de eventos. Un usuario exento también escribe como ella. Odoo no distinguirá a esa persona. La auditoría de ZDRY es el único rastro.

**Claves revocadas.** Odoo puede borrar la clave. La siguiente llamada falla. El estado pasa a Fallida, vuelve el modal y el trabajo en cola no debe completarse con otra cuenta.

**No registrar la clave en logs ni en auditoría.** Hoy un error de Odoo puede incluir el cuerpo de la petición. Hay que recortar usuario y clave de esos mensajes.

**Rendimiento.** Autenticar en cada `search_read` ya ocurre con la cuenta única. Con muchas personas, hace falta cache breve del `uid` por usuario. No se puede compartir un `uid` entre usuarios.

**El modal no sustituye a la API.** Ocultar botones en el navegador no basta. Cada ruta que lee o escribe Odoo debe rechazar al usuario sin vínculo, porque si no, la pantalla bloqueada se salta llamando al API.

**Compras y gerencia quedan fuera de la frase inicial.** Si no se decide ahora, sus cambios seguirán a nombre de la cuenta principal el día que comercial y despacho ya salgan con nombre propio.

**Cambiar URL o base.** Invalidar vínculos es correcto, pero deja a todo el equipo bloqueado hasta que cada uno vuelva a probar. El riesgo mayor no es el formulario: es tratar los id de la Odoo de pruebas como si existieran en producción. El corte está en la sección siguiente.

## Del Odoo de pruebas al de producción

Las pruebas corren en local, contra una Odoo de staging. En producción hay otra URL y otra base. El superadmin tiene que poder cambiar las dos desde Integración Odoo, sin tocar el código ni reconstruir el contenedor, y a partir de ahí sincronizar contra esa Odoo nueva.

Eso ya se puede guardar hoy: el ajuste `odoo_config` pisa lo que venga del entorno (`ODOO_URL`, `ODOO_DB`). No alcanza con guardar el texto nuevo. Los id numéricos que ZDRY guardó en staging (`odooLotId`, pedido de compra, pedido de venta, partner) no existen en la base de producción, o existen y son otro registro. Escribirlos ahí mezclaría lotes y pedidos.

Al confirmar el cambio de URL o de base, en este orden:

1. El superadmin escribe la URL y la base de producción, la cuenta principal de ese servidor y prueba la conexión. Si el test falla, no se aplica el corte.
2. Se anota en auditoría la URL y la base anteriores y las nuevas.
3. Los vínculos personales pasan a Sin vínculo. Cada comercial, despacho y administrador crea la clave en la Odoo de producción y vuelve a probar. La clave de staging no se reutiliza.
4. La cuenta principal también se reemplaza: el usuario y la clave de staging no abren producción.
5. Los trabajos en cola apuntados a staging no se reintentan contra producción. Quedan cerrados como “entorno anterior”.
6. La sincronización siguiente baja lotes, compras y existencias desde producción. El emparejamiento es por ISO (y los demás datos de negocio), no por el id de Odoo viejo. Esos id se limpian antes de la primera escritura.
7. Una cotización o un cierre ya emitido en staging no se vuelve a empujar solo. Si debe existir en producción, se emite de nuevo contra la base nueva.
8. Lo que es de ZDRY y no es un id de Odoo se conserva: fotos, precios, patio, visitas, personas. Eso es “mover los cambios”. Lo que no se mueve es el puntero al registro de la otra base.

Hasta que el paso 6 termine, las pantallas de Odoo muestran que el origen cambió y que la bajada está en curso, en lugar de los datos de staging.

## Orden para construirlo

1. Guardar el vínculo cifrado y el test (correo = login, más un permiso mínimo).
2. Hacer que `OdooClient` elija la cuenta según el usuario, la exención o la cuenta principal.
3. Cerrar en el API las lecturas y escrituras de Odoo si no hay vínculo activo.
4. Ocultar en pantalla los datos de Odoo y mostrar el modal cada 5 minutos.
5. Pantalla del superadmin para eximir, con auditoría.
6. Corte de URL y base: test de la cuenta principal, invalidar vínculos, frenar la cola del entorno anterior y volver a bajar por ISO, sin reutilizar id de Odoo.
7. Revisar las colas (cotización, cierre, alquiler, ficha) para que usen al usuario que las disparó.

Hasta cerrar si compras entra en la misma puerta, y qué modelos exactos prueba cada rol, no conviene empezar por el modal.

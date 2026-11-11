# Conductor y enlaces de cliente: una sola cola

La confirmación y la ubicación del conductor salen por `POST /SGIT/salida`, la misma ruta de los enlaces de catálogo. No hace falta un módulo nuevo ni otra URL. Una ruta distinta que siga escribiendo en la tabla `aviso` usa el mismo bot y la misma cola, así que no separa el tráfico.

## Qué se vio

En el chat del conductor llegó varias veces el mismo texto:

```text
Hola, Rafael prueba.
Su registro para DESCARGAR ha sido recibido.
```

En la ficha, el mismo número aparece `en_cola` y también `en_espera` con el motivo `Ese número todavía tiene un mensaje sin salir. Cuando salga, se puede cargar otro.`

Son dos cosas distintas.

| Respuesta de SGIT | Qué hizo SGIT | Qué ve el conductor |
|---|---|---|
| `en_cola` | Guardó un aviso nuevo, `aviso.estado = pendiente`. | Lo recibe cuando el bot lo envía. |
| `en_espera` | No guardó otro. Ya hay un pendiente para ese teléfono. | Nada nuevo. |

SGIT no apila dos WhatsApp al mismo número mientras el anterior sigue `pendiente`. Cada burbuja repetida del chat es un `en_cola` distinto: el anterior ya había pasado a `enviado` y ZDRY volvió a llamar. ZDRY, además, trataba `en_espera` como si el mensaje hubiera salido, y el botón Reenviar volvía a llamar.

El bot manda un aviso a la vez, con 5 segundos entre uno y otro. Si uno falla, lo reintenta durante 3 minutos, con 45 segundos de espera. Mientras ese aviso no está listo para salir, el bot no toma el siguiente, aunque sea de otro número y ya esté en hora. Un enlace de catálogo atascado frena la confirmación del conductor, y una confirmación atascada frena los enlaces.

## Qué hace ZDRY

Sin cambiar SGIT:

- `en_cola` se muestra como “quedó en la cola”. No se dice que el conductor ya lo recibió.
- `en_espera` se muestra como error, con el motivo de SGIT. No se carga otro.
- Durante 3 minutos, el mismo ingreso no vuelve a pedir confirmación ni ubicación si el último WhatsApp al conductor está `en_cola`, `en_espera` o `ya_enviado`.
- Reenviar no aparece en `en_cola`, `en_espera` ni `ya_enviado`. Sigue disponible si el aviso quedó en error u omitido.
- Cada confirmación manda `referencia` `zdry:visita:{id}:confirmacion`. Cada ubicación manda `zdry:visita:{id}:ubicacion`. El aviso interno manda una referencia por número, `zdry:visita:{id}:registro:{telefono}`, para que cada WhatsApp de la sede reciba el suyo.

La ficha interna del registro sigue en `POST /servicio/salida-registro`. Esa ruta arma el texto. La confirmación y la ubicación siguen en `POST /servicio/salida` porque llevan un texto propio.

## Cambio en SGIT

`tomarAviso` salta los avisos cuyo `no_enviar_antes` todavía no llega y toma el siguiente que ya está en hora. La pausa de 5 segundos entre envíos se mantiene. El candado por teléfono se mantiene: un número con un aviso `pendiente` sigue respondiendo `en_espera` y no recibe otro, sea enlace de catálogo o mensaje de conductor.

Un enlace en reintento deja pasar la confirmación de otro número, y al revés. Siguen saliendo por el mismo WhatsApp.

Si WhatsApp ya dejó el texto en el chat y después la página reporta un fallo, ese aviso queda `enviado`. No se vuelve a mandar el mismo texto durante el reintento de 45 segundos.

## Referencia

El campo ya se guarda. ZDRY puede mandarlo en el ítem de `POST /SGIT/salida` y también en el WhatsApp de `POST /SGIT/salida-registro`.

| Campo | Regla |
|---|---|
| `referencia` | Opcional. Hasta 80 caracteres. Confirmación: `zdry:visita:{id}:confirmacion`. Ubicación: `zdry:visita:{id}:ubicacion`. Aviso interno, una por número: `zdry:visita:{id}:registro:{telefono}`. |

Si llega `referencia` y ya hay un aviso `pendiente` con esa misma referencia, la respuesta es el aviso existente, `estado: "en_espera"`, motivo `Ese envío ya está en la cola.`, sin insertar otro. Si esa referencia ya salió (`aviso: "enviado"`) hace menos de 3 minutos, la respuesta es `estado: "ya_enviado"`, motivo `Ese envío ya salió.`, y tampoco se inserta otro. Pasados esos 3 minutos, una llamada nueva sí crea otro aviso: es un reenvío pedido a propósito.

`telefono`, `mensaje` y `contacto` no cambian. Un ítem sin `referencia` sigue como hoy.

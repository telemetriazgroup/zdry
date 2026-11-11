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

- `en_cola` se muestra como “quedó en la cola”. Cuando la consulta dice que SGIT ya lo envió, pasa a `enviado`.
- `en_espera` y el aviso de 2 mensajes pendientes se muestran en un modal.
- Reenviar no aparece en `en_cola`, `en_espera`, `enviado` ni `ya_enviado`. Sigue disponible si el aviso quedó en error u omitido.
- Cada confirmación y cada ubicación llevan una `referencia` propia, `zdry:visita:{id}:confirmacion:{n}` o `zdry:visita:{id}:ubicacion:{n}`. Se pueden dejar **2** en cola para el mismo ingreso. A partir de la tercera, ZDRY avisa en un modal que hay mensajes pendientes.
- Cada 30 segundos, si hay avisos en cola, ZDRY consulta `POST /servicio/salida/estado` y pasa el aviso a `enviado` cuando SGIT ya lo mandó. Si pasan 5 minutos y sigue sin salir, avisa en un modal que no se llegó a enviar el mensaje a ese conductor.

La ficha interna del registro sigue en `POST /servicio/salida-registro`. Esa ruta arma el texto. La confirmación y la ubicación siguen en `POST /servicio/salida` porque llevan un texto propio.

## Cambio en SGIT

`tomarAviso` salta los avisos cuyo `no_enviar_antes` todavía no llega y toma el siguiente que ya está en hora. La pausa de 5 segundos entre envíos se mantiene. El candado por teléfono se mantiene para el resto de avisos: un solo pendiente. Una referencia `zdry:` puede dejar hasta 2 pendientes en ese número. El tercero responde `en_espera`.

Un enlace en reintento deja pasar la confirmación de otro número, y al revés. Siguen saliendo por el mismo WhatsApp.

Si WhatsApp ya dejó el texto en el chat y después la página reporta un fallo, ese aviso queda `enviado`. No se vuelve a mandar el mismo texto durante el reintento de 45 segundos.

## Referencia

El campo ya se guarda. ZDRY puede mandarlo en el ítem de `POST /SGIT/salida` y también en el WhatsApp de `POST /SGIT/salida-registro`.

| Campo | Regla |
|---|---|
| `referencia` | Opcional. Hasta 80 caracteres. Confirmación: `zdry:visita:{id}:confirmacion:{n}`. Ubicación: `zdry:visita:{id}:ubicacion:{n}`. Aviso interno, una por número: `zdry:visita:{id}:registro:{telefono}`. |

Si llega `referencia` y ya hay un aviso `pendiente` con esa misma referencia, la respuesta es el aviso existente, `estado: "en_espera"`, motivo `Ese envío ya está en la cola.`, sin insertar otro. Si esa referencia ya salió (`aviso: "enviado"`) hace menos de 3 minutos, la respuesta es `estado: "ya_enviado"`, motivo `Ese envío ya salió.`, y tampoco se inserta otro. Pasados esos 3 minutos, una llamada nueva sí crea otro aviso: es un reenvío pedido a propósito.

`telefono`, `mensaje` y `contacto` no cambian. Un ítem sin `referencia` sigue como hoy. Un número sin referencia de ZDRY sigue aceptando un solo pendiente. Una referencia que empieza por `zdry:` puede dejar hasta 2 pendientes en ese número. El tercero responde `en_espera`.

## Consulta de estado

No envía nada y no toca los demás avisos de SGIT. ZDRY la llama cada 30 segundos solo cuando tiene WhatsApp de conductor en cola.

`POST /servicio/salida/estado` con el mismo header `x-salida-clave`.

```json
{ "referencias": ["zdry:visita:{id}:confirmacion:1"] }
```

Hasta 30 referencias. La respuesta trae el último aviso de cada una:

```json
{
  "avisos": [
    { "referencia": "zdry:visita:{id}:confirmacion:1", "estado": "enviado", "enviadoEn": "2026-11-11T13:13:00.000Z", "motivo": "" }
  ]
}
```

`estado` del aviso es `pendiente`, `enviado` o `cerrado`. Si la referencia no existe, no viene en la lista.

# Salida de WhatsApp y correo

Guía para que una aplicación externa deje un mensaje de WhatsApp o un correo en SGIT. SGIT lo guarda y lo envía. La aplicación no habla con WhatsApp ni con Gmail.

## Datos de conexión

| Dato | Valor |
|---|---|
| Método | `POST` |
| URL en producción | `https://ztrack.app/servicio/salida` |
| Ruta en la API | `/SGIT/salida` |
| Cuerpo | `application/json` |
| Autenticación | Header `x-salida-clave` |

La clave es el valor de `SALIDA_CLAVE` en el servidor de SGIT. No va en el cuerpo. En los ejemplos, `TU_CLAVE` es ese valor y `BASE` es `https://ztrack.app/servicio`.

Si la clave falta o no coincide, la respuesta es `401` y el texto `Falta la clave de salida.`

Un usuario de SGIT con rol superusuario, administrador u operador también puede llamar esta ruta con su sesión (`Authorization: Bearer …`). La aplicación externa usa la clave.

## Qué acepta

Un solo POST puede traer WhatsApp, correo, o los dos. Cada uno puede ser un objeto o una lista. El máximo es **30 WhatsApp y 30 correos** por llamada.

| Campo | Uso |
|---|---|
| `whatsapp` | Uno o varios mensajes de WhatsApp |
| `correo` o `correos` | Uno o varios correos |

Si no viene ninguno de los dos, la respuesta es `400`: `Indica un WhatsApp o un correo.` Si una lista pasa de 30, la respuesta es `400`: `El máximo es 30 mensajes por envío.`

Un ítem inválido no tumba al resto. Ese ítem vuelve con `estado: "rechazado"` y `motivo`. Los válidos quedan en cola.

## WhatsApp

| Campo | Obligatorio | Regla |
|---|---|---|
| `telefono` | Sí | Número de destino. Solo se usan los dígitos. Si son 9, se antepone `51`. Tiene que quedar entre 8 y 15 dígitos. |
| `mensaje` | Sí | Texto que envía el bot. También se acepta el nombre `cuerpo`. Hasta 4000 caracteres. |
| `contacto` | Sí | Número al que esa persona debe llamar si responde. Misma regla de dígitos que `telefono`. |

SGIT guarda el mensaje y lo pone en la cola del bot. El texto no se recorta ni se rechaza por haber mandado uno antes.

Se puede cargar otro mensaje al mismo número cuando el anterior **ya salió** (`aviso: "enviado"`) o cuando el anterior se cerró sin salir (`aviso: "cerrado"`). Si todavía está en cola, este ítem no se duplica: vuelve `en_espera` y se puede intentar de nuevo cuando el primero haya salido.

Cuando el mensaje ya se envió y esa persona escribe al WhatsApp de SGIT, si no es un usuario del sistema, el bot le responde solo esto:

`Para continuar, comunícate al {contacto}.`

`{contacto}` es el número que vino en el POST. No entra al menú de tareas. Un número que ya es usuario de SGIT sigue con su menú normal.

Ejemplo de uno:

```bash
curl -sS -X POST "$BASE/salida" \
  -H "content-type: application/json" \
  -H "x-salida-clave: TU_CLAVE" \
  -d '{
    "whatsapp": {
      "telefono": "51987654321",
      "mensaje": "Su unidad ya está programada.",
      "contacto": "51911111111"
    }
  }'
```

Respuesta cuando queda en cola:

```json
{
  "whatsapp": [
    {
      "id": "uuid",
      "telefono": "51987654321",
      "estado": "en_cola",
      "aviso": "pendiente"
    }
  ],
  "correos": []
}
```

Respuesta si ese número todavía tiene un mensaje sin salir:

```json
{
  "whatsapp": [
    {
      "id": "uuid-anterior",
      "telefono": "51987654321",
      "estado": "en_espera",
      "aviso": "pendiente",
      "motivo": "Ese número todavía tiene un mensaje sin salir. Cuando salga, se puede cargar otro."
    }
  ],
  "correos": []
}
```

Si el anterior ya salió, la misma llamada crea uno nuevo y responde `en_cola`. `aviso` del envío anterior puede ser `pendiente`, `enviado` o `cerrado`. `cerrado` significa que no salió y SGIT dejó de reintentarlo; en ese caso también se puede cargar otro.

Varios en la misma llamada:

```bash
curl -sS -X POST "$BASE/salida" \
  -H "content-type: application/json" \
  -H "x-salida-clave: TU_CLAVE" \
  -d '{
    "whatsapp": [
      { "telefono": "987654321", "mensaje": "Primer aviso", "contacto": "51911111111" },
      { "telefono": "51922222222", "mensaje": "Segundo aviso", "contacto": "51911111111" }
    ]
  }'
```

`987654321` se guarda como `51987654321`.

## Correo

| Campo | Obligatorio | Regla |
|---|---|---|
| `direccion` | Sí | Destino. Tiene que ser un correo y no pasar de 180 caracteres. |
| `asunto` | Sí | Hasta 180 caracteres. |
| `cuerpo` | Sí | Texto plano. Hasta 8000 caracteres. |

SGIT guarda cada correo y lo envía **de a uno**, con **20 segundos** entre un envío y el siguiente. No salen todos juntos. La hora prevista viene en `noEnviarAntes`.

El remitente es la casilla de SGIT (`telemetria@zgroup.com.pe`). Para que salga, esa casilla tiene que estar vinculada con permiso de envío de Gmail. Si solo tiene permiso de lectura, el correo queda en fallo y no se reintenta solo.

Ejemplo:

```bash
curl -sS -X POST "$BASE/salida" \
  -H "content-type: application/json" \
  -H "x-salida-clave: TU_CLAVE" \
  -d '{
    "correo": {
      "direccion": "cliente@ejemplo.com",
      "asunto": "Programación de unidad",
      "cuerpo": "Su unidad ya está programada."
    }
  }'
```

Respuesta:

```json
{
  "whatsapp": [],
  "correos": [
    {
      "id": "uuid",
      "direccion": "cliente@ejemplo.com",
      "estado": "en_cola",
      "noEnviarAntes": "2026-10-29T14:00:00.000Z"
    }
  ]
}
```

`noEnviarAntes` está en UTC. El segundo correo de la misma tanda, o el que llegue mientras todavía hay cola, queda 20 segundos después del anterior.

El mismo destino puede recibir otro correo cuando el anterior ya salió, o cuando el anterior quedó en fallo. Si todavía está en cola, la respuesta de ese ítem es `en_espera` y no se duplica. Entre un envío y el siguiente siguen pasando 20 segundos.

## Los dos en la misma llamada

```bash
curl -sS -X POST "$BASE/salida" \
  -H "content-type: application/json" \
  -H "x-salida-clave: TU_CLAVE" \
  -d '{
    "whatsapp": {
      "telefono": "51987654321",
      "mensaje": "Su unidad ya está programada.",
      "contacto": "51911111111"
    },
    "correo": {
      "direccion": "cliente@ejemplo.com",
      "asunto": "Programación de unidad",
      "cuerpo": "Su unidad ya está programada."
    }
  }'
```

## Estados de cada ítem

| `estado` | Significado |
|---|---|
| `en_cola` | Quedó guardado. WhatsApp lo toma el bot. El correo sale cuando llega `noEnviarAntes`, con 20 segundos de separación. |
| `en_espera` | El destino ya tiene un mensaje que todavía no sale. No se cargó otro. `motivo` lo dice. Cuando el anterior salga, se puede volver a llamar. |
| `rechazado` | No se guardó. `motivo` dice por qué. El `id` viene vacío. |

Motivos de rechazo:

| Caso | `motivo` |
|---|---|
| Teléfono o contacto fuera de 8 a 15 dígitos | `El teléfono tiene entre 8 y 15 dígitos.` o `Falta el número al que debe contactarse.` |
| Mensaje de WhatsApp vacío o de más de 4000 caracteres | `El mensaje es obligatorio y llega hasta 4000 caracteres.` |
| Correo mal escrito | `La dirección de correo no es válida.` |
| Asunto vacío o de más de 180 caracteres | `El asunto es obligatorio y llega hasta 180 caracteres.` |
| Cuerpo vacío o de más de 8000 caracteres | `El cuerpo es obligatorio y llega hasta 8000 caracteres.` |

## Qué no hace esta ruta

No devuelve el texto enviado ni la clave. No cancela un mensaje ya encolado. No apila otro mensaje al mismo número o correo mientras el anterior sigue sin salir.

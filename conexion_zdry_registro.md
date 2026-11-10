# Conexión de ZDRY: registro de conductor

Contrato para que ZDRY avise una inscripción del control de ingreso. ZDRY manda los datos de la ficha. SGIT arma el correo con el diseño de la tarjeta y el WhatsApp con un dato por línea. ZDRY no manda HTML ni un texto ya armado.

La ruta de catálogos `POST /SGIT/salida` no cambia. Sigue documentada en `conexion_api_was_correo.md`.

## Enlaces

| Uso | Método | URL |
|---|---|---|
| Oficial, producción | `POST` | `https://ztrack.app/servicio/salida-registro` |
| Equivalente, mismo servicio | `POST` | `https://ztrack.app/SGIT/servicio/salida-registro` |
| Ruta interna de la API | `POST` | `/SGIT/salida-registro` |

Las dos URL de producción llegan a la misma ruta. El cuerpo es `application/json`.

En el servidor, contra el API directo: `POST http://127.0.0.1:18003/SGIT/salida-registro`.

## Autenticación

Header `x-salida-clave`. El valor es `SALIDA_CLAVE` del servidor, el mismo de `POST /SGIT/salida`. No va en el cuerpo.

```http
POST /servicio/salida-registro HTTP/1.1
Host: ztrack.app
Content-Type: application/json
x-salida-clave: TU_CLAVE
```

Si la clave falta o no coincide, la respuesta es `401` y el texto `Falta la clave de salida.`

Un usuario de SGIT con rol superusuario, administrador u operador también puede llamarla con `Authorization: Bearer …`. ZDRY usa la clave.

## Qué acepta

Una llamada es una inscripción. Varias direcciones y varios WhatsApp de esa misma ficha pueden ir juntos. Otra inscripción es otra llamada.

| Campo | Uso |
|---|---|
| `registro` | Datos de la ficha. Obligatorio. |
| `whatsapp` | Uno o varios avisos. Objeto o lista. |
| `correo` o `correos` | Uno o varios correos. Objeto o lista. |

El máximo es **30 WhatsApp y 30 correos** por llamada. Si no viene ninguno de los dos, la respuesta es `400`: `Indica un WhatsApp o un correo.` Si una lista pasa de 30, la respuesta es `400`: `El máximo es 30 mensajes por envío.`

`whatsapp.mensaje`, `whatsapp.cuerpo`, `correo.cuerpo` y `correo.html` no se usan. SGIT escribe el texto y el HTML. Si vienen en el JSON, se ignoran.

## Ficha `registro`

| Campo | Obligatorio | Si falta |
|---|---|---|
| `sede` | Sí | Se rechaza la llamada de ese ítem |
| `motivo` | Sí | Igual |
| `fecha` | Sí, o `fechaHora` | Igual. `hora` es opcional y se muestra debajo de la fecha |
| `placaTracto` | Sí | También se acepta `placa_tracto` |
| `conductor` | Sí | |
| `id` | Sí | Identificador de la inscripción, por ejemplo `ZG-20261110-095608` |
| `placaCarreta` | No | `NO INDICADO`. También `placa_carreta` |
| `empresa` | No | `NO INDICADO` |
| `ruc` | No | `NO INDICADO` |
| `brevete` | No | `NO INDICADO` |
| `telefono` | No | `NO INDICADO`. Es el teléfono del conductor, no el de WhatsApp |
| `codigoEquipo` | No | `NO INDICADO`. También `codigo_equipo` |
| `estado` | No | `REGISTRADO` |
| `observaciones` | No | `SIN OBSERVACIONES` |

Si falta un obligatorio, cada ítem de la llamada vuelve `rechazado` con:

`Falta sede, motivo, fecha, conductor, placa del tracto o id del registro.`

## WhatsApp

| Campo | Obligatorio | Regla |
|---|---|---|
| `telefono` | Sí | Número de destino. Solo se usan los dígitos. Si son 9, se antepone `51`. Tiene que quedar entre 8 y 15 dígitos. |
| `contacto` | Sí | Número al que esa persona debe llamar si responde. Misma regla de dígitos. |

SGIT arma el mensaje. Cada dato va en su línea, con un espacio entre grupos:

```text
*NUEVO REGISTRO DE CONDUCTOR*
Control de ingreso

*Sede:* LIMA
*Motivo:* CARGAR CONTENEDOR
*Fecha y hora:* 10/11/2026 09:56:08
*Estado:* REGISTRADO

*Placa tracto:* CYB.476
*Placa carreta:* A8F974
*Conductor:* DOMINGO CHUCO CAPCHA

*Empresa:* LH TRADE
*RUC:* 20545385296
*Brevete:* 21106707
*Teléfono:* 954124973
*Código de equipo:* NO INDICADO

*Observaciones:* SIN OBSERVACIONES
*ID de registro:* ZG-20261110-095608
```

La cola, la espera y la respuesta del bot son las de `POST /SGIT/salida`. Cuando la persona escribe y no es usuario de SGIT, el bot responde: `Para continuar, comunícate al {contacto}.`

## Correo

| Campo | Obligatorio | Regla |
|---|---|---|
| `direccion` | Sí | Correo válido, hasta 180 caracteres. También se acepta `para`. Varias direcciones van separadas por coma, punto y coma o salto de línea, hasta 20. |
| `copia` | No | También `cc`. Misma regla. |
| `copiaOculta` | No | También `cco` o `bcc`. |
| `asunto` | No | Si no viene, SGIT usa `[SEDE] MOTIVO \| PLACA TRACTO`. Hasta 180 caracteres. |

El correo sale en dos partes:

- texto plano, con las mismas etiquetas de la ficha, una por línea;
- HTML de la tarjeta: encabezado ZGROUP / INGENIERÍA EN FRÍO, franja `NUEVO REGISTRO DE CONDUCTOR` / `CONTROL DE INGRESO`, sede, motivo, fecha y hora, estado, placas, conductor, detalle, observaciones e id.

La marca del encabezado va en texto, en la misma posición de la tarjeta, para que se vea en Gmail sin depender de una imagen. El nombre visible del remitente es `Registro de Conductores - ZGROUP`, en la casilla de SGIT. Cada correo sale con 20 segundos de separación. `noEnviarAntes` viene en UTC.

## Ejemplo

```bash
curl -sS -X POST "https://ztrack.app/servicio/salida-registro" \
  -H "content-type: application/json" \
  -H "x-salida-clave: TU_CLAVE" \
  -d '{
    "registro": {
      "sede": "LIMA",
      "motivo": "CARGAR CONTENEDOR",
      "fecha": "10/11/2026",
      "hora": "09:56:08",
      "placaTracto": "CYB.476",
      "placaCarreta": "A8F974",
      "conductor": "DOMINGO CHUCO CAPCHA",
      "empresa": "LH TRADE",
      "ruc": "20545385296",
      "brevete": "21106707",
      "telefono": "954124973",
      "codigoEquipo": "NO INDICADO",
      "estado": "REGISTRADO",
      "observaciones": "SIN OBSERVACIONES",
      "id": "ZG-20261110-095608"
    },
    "whatsapp": {
      "telefono": "51900000000",
      "contacto": "51900000001"
    },
    "correo": {
      "direccion": "operaciones@zgroup.com.pe"
    }
  }'
```

Respuesta cuando ambos quedan en cola:

```json
{
  "whatsapp": [
    {
      "id": "uuid",
      "telefono": "51900000000",
      "estado": "en_cola",
      "aviso": "pendiente"
    }
  ],
  "correos": [
    {
      "id": "uuid",
      "direccion": "operaciones@zgroup.com.pe",
      "estado": "en_cola",
      "noEnviarAntes": "2026-11-10T14:56:08.000Z"
    }
  ]
}
```

## Estados de cada ítem

| `estado` | Significado |
|---|---|
| `en_cola` | Quedó guardado. WhatsApp lo toma el bot. El correo sale cuando llega `noEnviarAntes`. |
| `en_espera` | El destino ya tiene un mensaje que todavía no sale. No se cargó otro. |
| `rechazado` | No se guardó. `motivo` dice por qué. El `id` viene vacío. |

Un ítem inválido no tumba al resto.

| Caso | `motivo` |
|---|---|
| Ficha incompleta | `Falta sede, motivo, fecha, conductor, placa del tracto o id del registro.` |
| Teléfono o contacto fuera de 8 a 15 dígitos | `El teléfono tiene entre 8 y 15 dígitos.` o `Falta el número al que debe contactarse.` |
| Correo mal escrito | `La dirección de correo no es válida.` |
| Copia mal escrita | `La copia no es un correo válido.` |
| Copia oculta mal escrita | `La copia oculta no es un correo válido.` |
| Más de 20 correos en una lista | `Cada lista admite hasta 20 correos.` |
| Asunto de más de 180 caracteres | `El asunto es obligatorio y llega hasta 180 caracteres.` |

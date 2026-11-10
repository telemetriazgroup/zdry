# Caso SGIT: correo HTML del registro de conductores

Pedido para SGIT. ZDRY va a avisar a operaciones cuando un conductor se inscribe en el control de ingreso. El WhatsApp de ese aviso puede seguir por la ruta actual. El correo tiene que salir con la ficha en HTML, y la ruta `POST /SGIT/salida` documentada en `conexion_api_was_correo.md` define `cuerpo` como texto plano.

Hace falta una ruta específica, con la misma cola, la misma clave y los mismos estados, que envíe el HTML como cuerpo del correo. La ruta actual no se modifica: los enlaces de catálogo siguen saliendo por ahí.

## Ruta pedida

| Dato | Valor |
| --- | --- |
| Método | `POST` |
| URL propuesta | `https://ztrack.app/servicio/salida-registro` |
| Ruta en la API | `/SGIT/salida-registro` |
| Cuerpo | `application/json` |
| Autenticación | Header `x-salida-clave`, el mismo `SALIDA_CLAVE` |

Si la clave falta o no coincide, la respuesta es `401` y el texto `Falta la clave de salida.`

Un usuario de SGIT con rol superusuario, administrador u operador también puede llamarla con `Authorization: Bearer …`. ZDRY usa la clave.

## Qué hace, igual que `/salida`

- Acepta WhatsApp, correo, o los dos, en la misma llamada.
- Cada uno puede ser un objeto o una lista.
- El máximo es 30 WhatsApp y 30 correos. Si una lista pasa de 30, responde `400`: `El máximo es 30 mensajes por envío.`
- Si no viene ninguno de los dos, responde `400`: `Indica un WhatsApp o un correo.`
- Un ítem inválido no tumba al resto. Ese ítem vuelve `rechazado` con `motivo`. Los válidos quedan en cola.
- WhatsApp entra a la cola del bot. El texto no se recorta por haber mandado uno antes.
- Otro WhatsApp al mismo número espera a que el anterior tenga `aviso: "enviado"` o `aviso: "cerrado"`. Si sigue en cola, el ítem vuelve `en_espera` y no se duplica.
- Cuando la persona escribe al WhatsApp de SGIT y no es usuario del sistema, el bot responde solo: `Para continuar, comunícate al {contacto}.`
- Cada correo sale de a uno, con 20 segundos entre envíos. `noEnviarAntes` viene en UTC.
- El mismo correo puede recibir otro cuando el anterior ya salió o quedó en fallo. Si todavía está en cola, ese ítem vuelve `en_espera`.
- El remitente sigue siendo la casilla de SGIT (`telemetria@zgroup.com.pe`), con permiso de envío de Gmail.
- El nombre visible de este correo, si Gmail lo permite en esta ruta, es `Registro de Conductores - ZGROUP`.

## WhatsApp

Igual que en `/salida`.

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `telefono` | sí | Solo dígitos. Si son 9, se antepone `51`. Entre 8 y 15 dígitos. |
| `mensaje` | sí | Texto. También se acepta `cuerpo`. Hasta 4000 caracteres. |
| `contacto` | sí | Número de respuesta. Misma regla de dígitos. |

ZDRY manda este canal en texto. La ficha HTML no va en el WhatsApp.

## Correo

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `direccion` | sí | Correo válido, hasta 180 caracteres. |
| `asunto` | sí | Hasta 180 caracteres. |
| `cuerpo` | sí | Texto plano alternativo, hasta 8000 caracteres. |
| `html` | sí en esta ruta | Cuerpo HTML que ZDRY ya armó, hasta 20000 caracteres. |

SGIT envía un mensaje con dos partes:

- `text/plain` con `cuerpo`;
- `text/html` con `html`.

El cliente de correo muestra el HTML. Quien no lo soporte ve el texto plano. SGIT no reescribe la maqueta: el HTML llega listo, con estilos en línea.

Si `html` viene vacío, el ítem se rechaza con motivo `El cuerpo HTML es obligatorio.` El resto de la llamada sigue. Así esta ruta no se usa por error como la de texto plano.

## Ejemplo

```bash
curl -sS -X POST "https://ztrack.app/servicio/salida-registro" \
  -H "content-type: application/json" \
  -H "x-salida-clave: TU_CLAVE" \
  -d '{
    "whatsapp": [
      {
        "telefono": "51900000000",
        "mensaje": "[LIMA] CARGAR CONTENEDOR | CYB.476\nConductor: DOMINGO CHUCO CAPCHA\nID: ZG-20261110-095608",
        "contacto": "51900000001"
      }
    ],
    "correo": [
      {
        "direccion": "operaciones@zgroup.com.pe",
        "asunto": "[LIMA] CARGAR CONTENEDOR | CYB.476",
        "cuerpo": "SEDE: LIMA\nMOTIVO: CARGAR CONTENEDOR\nPLACA TRACTO: CYB.476\nCONDUCTOR: DOMINGO CHUCO CAPCHA\nID: ZG-20261110-095608",
        "html": "<!DOCTYPE html><html lang=\"es\"><body><p>Nuevo registro de conductor</p><p>LIMA · CARGAR CONTENEDOR · CYB.476</p><p>ZG-20261110-095608</p></body></html>"
      }
    ]
  }'
```

Varios correos de la misma inscripción viajan en esa lista. Cada uno lleva el mismo `asunto`, el mismo `cuerpo` y el mismo `html`, con su `direccion`.

## Respuesta

La forma es la de `/salida`.

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
      "noEnviarAntes": "2026-11-10T15:00:00.000Z"
    }
  ]
}
```

| `estado` | Significado |
| --- | --- |
| `en_cola` | Quedó guardado. WhatsApp lo toma el bot. El correo sale al llegar `noEnviarAntes`. |
| `en_espera` | Ese destino todavía tiene un mensaje sin salir. No se cargó otro. |
| `rechazado` | No se guardó. `motivo` dice por qué. El `id` viene vacío. |

Motivos de rechazo, además de los que ya tiene `/salida`:

| Caso | `motivo` |
| --- | --- |
| `html` vacío o de más de 20000 caracteres | `El cuerpo HTML es obligatorio y llega hasta 20000 caracteres.` |

La respuesta no devuelve el HTML, el texto ni la clave. No cancela un mensaje ya encolado.

## Ficha que ZDRY pone en `html`

ZDRY arma el HTML. SGIT solo lo entrega. La ficha, con el caso real del 10/11/2026, lleva:

- encabezado ZGROUP, título «Nuevo registro de conductor» y bajada «Control de ingreso»;
- sede `LIMA`, motivo `CARGAR CONTENEDOR`, fecha y hora `10/11/2026 09:56:08`, marca `REGISTRADO`;
- placa tracto `CYB.476`, placa carreta `A8F974`, conductor `DOMINGO CHUCO CAPCHA`;
- detalle: empresa `LH TRADE`, RUC `20545385296`, brevete `21106707`, teléfono `954124973`, código de equipo `NO INDICADO`, estado `REGISTRADO`;
- observaciones `SIN OBSERVACIONES`;
- id `ZG-20261110-095608`.

El asunto de ese caso es `[LIMA] CARGAR CONTENEDOR | CYB.476`.

## Qué no cambia

`POST /SGIT/salida` sigue igual, con `cuerpo` de texto plano, para los enlaces de catálogo y el resto de avisos. Esta ruta es solo el registro de conductores.

## Mientras la ruta no esté

ZDRY guarda el ingreso y el PDF del conductor igual. El correo interno de este módulo espera esta ruta. El WhatsApp interno puede salir por `/salida`, que ya acepta texto.

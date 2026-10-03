# Control de publicación del catálogo

Propuesta para que publicar, ya publicado y ocultar se lean solos. Hoy el mismo botón naranja dice «Publicar» aunque la unidad ya esté visible.

Ejemplo de la captura: **MSKU0225553** tiene 8 fotos y la ficha dice «Visible en catálogo», pero la fila y la ficha siguen ofreciendo **Publicar en catálogo**. Al lado hay otro botón, **Ocultar del catálogo**. Los dos juntos se leen como si todavía hubiera que publicar.

El estado ya existe en el equipo (`mediaStatus`):

| Estado guardado | Qué significa | Cómo se ve hoy |
|---|---|---|
| `pendiente` | Tiene ficha, aún no sale al cliente | El número de fotos va en naranja y el botón dice Publicar |
| `aprobado` | Ya está en el catálogo | El número de fotos va en verde, pero el botón sigue diciendo Publicar |
| `oculto` / `rechazado` | Se bajó del catálogo; las fotos se conservan | El botón Publicar vuelve a estar activo y Ocultar queda apagado |

## Lo que el operador tiene que ver de un vistazo

Cuatro situaciones, siempre con las mismas palabras en la fila y en la ficha.

1. **Sin fotos.** No se puede publicar. El botón no se ofrece. El texto es «Sin fotos».
2. **Por publicar.** Hay al menos una foto y no hay bloqueo (reentrega sin OC, vendido o ya en el cliente). Botón naranja: **Publicar**.
3. **Publicada.** El cliente ya la ve. Un solo botón, verde: **Ocultar de publicación**. El verde dice «está publicada». El texto dice qué pasa si se pulsa.
4. **No se puede publicar.** Reentrega sin conciliar, o el equipo ya salió. Sin botón. Se muestra el motivo que ya devuelve `publishBlock`.

No quedan dos botones juntos (Publicar y Ocultar). Queda uno, y cambia según el estado.

```
Sin fotos          →  sin botón
Por publicar       →  [ Publicar ]                  naranja
Publicada          →  [ Ocultar de publicación ]    verde
No se puede        →  sin botón + el motivo
```

Ocultar pide confirmación: «¿Ocultar MSKU0225553 del catálogo? Las fotos se conservan.» Así el verde no se pulsa por costumbre de pulsar el botón de color.

## La fila y la ficha dicen lo mismo

Hoy la columna **Fotos** solo muestra el número, coloreado. El color no se explica. Pasa a mostrar el número y la situación:

- `8 · publicada` en verde
- `8 · por publicar` en naranja
- `0 · sin fotos` en gris
- `8 · no se publica` en gris, con el motivo en el título del botón o de la celda

En la ficha del equipo, el mismo botón reemplaza a «Publicar en catálogo» y a «Ocultar del catálogo»:

- si `mediaStatus` no es `aprobado` y hay fotos y no hay bloqueo: **Publicar** (naranja), como ahora
- si `mediaStatus` es `aprobado`: **Ocultar de publicación** (verde), y llama al ocultar que ya existe (`POST /catalog-media/:iso/hide`)

La lista hace lo mismo. Si la fila ya está publicada, pulsar ese botón verde oculta. No vuelve a llamar a publicar.

## Buscador y «equipos con fotos»

**Solo con fotos** sigue mostrando las que tienen foto, publicadas o no. Si no, al filtrar desaparecerían las que ya están en el catálogo.

Lo que cambia es la selección para publicar:

- **Seleccionar con fotos** marca solo las que están **por publicar** (tienen foto, no están publicadas, no están bloqueadas).
- Una publicada no lleva casilla activa. El título del casilla es «Ya está publicada».
- El casilla de la cabecera tampoco las cuenta.
- Si alguien intenta incluirla, el aviso es «MSKU0225553 ya está publicada», no un error de publicación.

Así «Seleccionar con fotos» significa «las que faltan por publicar», no «todas las que tienen archivo».

## Agrupar las que ya están publicadas

Encima de la tabla, cuatro grupos con su cantidad. Se elige uno; la búsqueda por ISO sigue valiendo dentro del grupo.

| Grupo | Qué entra |
|---|---|
| Por publicar | Con fotos, todavía no `aprobado`, sin bloqueo |
| Publicadas | `mediaStatus === aprobado` |
| Sin fotos | Cero fotos y sin bloqueo |
| No se pueden publicar | Reentrega sin OC, vendido o con salida |

Al abrir la pantalla el grupo activo es **Por publicar**, porque es el trabajo pendiente. **Publicadas** junta las que ya salieron al cliente, como MSKU0225553, para revisarlas o bajarlas sin mezclarlas con las pendientes.

Dentro de **Publicadas**, la selección cambia de sentido: el botón de la barra dice **Ocultar selección** y es verde. No aparece «Publicar selección» en ese grupo. En **Por publicar** la barra sigue diciendo **Publicar selección**.

La línea de ayuda de la página pasa a ser: «Por publicar son las que tienen fotos y aún no se ven. Publicadas ya están en el catálogo: el botón verde las oculta.»

## Qué se toca y qué no

Pantalla: `apps/web/src/pages/CatalogMedia.jsx`.

- Un estado de grupo (`por publicar`, `publicadas`, `sin fotos`, `bloqueadas`) junto al buscador y a «Solo con fotos».
- `publishLock` sigue bloqueando reentrega y salida. Se le suma «ya publicada» solo para la selección de publicar, no para ocultar.
- El botón de la fila y el de la ficha leen `mediaStatus === "aprobado"`.
- Estilo nuevo para el botón verde (el naranja de `btn-primary` se queda para Publicar).

API: no hace falta un estado nuevo. Publicar sigue en `POST /catalog-media/:iso/approve` y ocultar en `POST /catalog-media/:iso/hide`. El lote de hoy (`publish-batch`) se usa solo con las que están por publicar. Ocultar varias es el mismo `hide`, una por una, sobre la selección del grupo Publicadas.

No cambia el precio, la marca de agua, ni quién puede publicar (administrador y gerencia). Una unidad bloqueada no entra en Por publicar ni en Publicadas.

# ZDRY — El supermercado de contenedores
## Documentación técnica y funcional del prototipo

**Versión del documento:** 1.0 — agosto 2026
**Alcance:** `zdry_prototype.html` — aplicación de una sola página (SPA), autocontenida, sin backend.
**Audiencia:** equipo de negocio, equipo de producto y equipo de desarrollo que evalúe llevar el prototipo a producción.

---

## 0. Resumen ejecutivo

ZDRY es un prototipo funcional de marketplace y ERP para una empresa de compra, alquiler y venta de contenedores marítimos en el Perú. Cubre el ciclo completo del negocio: compra e importación de unidades, recepción y ubicación física en patio, venta y alquiler a clientes, despacho logístico, cotización de fletes, costos operativos de terceros y reportes gerenciales — todo dentro de un único archivo HTML que corre en el navegador, sin servidor ni base de datos.

El prototipo no se construyó de una sola vez: creció por rondas sucesivas, cada una resolviendo una necesidad concreta del negocio (primero el catálogo y las reglas de precio, luego compras e inventario, luego patio, luego alquileres con seguimiento de pagos, luego un motor de fletes inteligente, luego el reglamento automático de costos de terceros). Este documento reorganiza esa evolución en **fases lógicas de desarrollo**, de modo que se pueda leer como una hoja de ruta: qué depende de qué, qué reglas de negocio quedaron codificadas en cada fase, qué casos de uso cubre, y qué implicancias tiene cada una de cara a una eventual puesta en producción.

---

## 1. Metodología de desarrollo por fases

El sistema se documenta y se construyó siguiendo una lógica **incremental por capas de dependencia**, no un cronograma con fechas fijas: cada fase habilita datos o reglas que la siguiente necesita para tener sentido. Esto equivale a un desarrollo iterativo (similar a Scrum/RUP en espíritu) donde cada incremento es entregable y demostrable por sí mismo, pero el orden importa porque:

- No se puede vender ni alquilar una unidad que no existe → **Compras** antecede a **Comercial**.
- No se puede despachar una unidad que no tiene ubicación física ni nacionalización → **Almacén/Patio** antecede a **Despachos**.
- No se puede cotizar un flete sin un motor de distancia/costo → **Fletes** es un servicio transversal que usan Comercial y el catálogo público.
- No se puede fijar reglas de precio o de patio si no existen los catálogos maestros (tipos, categorías, depósitos) → **Fundamentos** antecede a todo.

Cada fase de este documento describe: **objetivo de negocio**, **funciones y pantallas que la implementan**, **casos de uso cubiertos**, **reglas de negocio críticas** (lo que el sistema bloquea o calcula automáticamente, no solo lo que sugiere por texto) e **implicancias** (qué queda simulado, qué riesgo u oportunidad implica para el negocio real).

---

## 2. Arquitectura y estructura lógica

### 2.1 Arquitectura general

ZDRY es una aplicación de una sola página, un único archivo HTML con un bloque `<script>` inline (~6,600 líneas) que contiene tanto la lógica de negocio como la interfaz. No hay backend, no hay base de datos, no hay llamadas de red propias. Todo el estado vive en variables JavaScript globales (arreglos como `CONTAINERS`, `QUOTES`, `RENTALS`, `DISPATCHES`, etc.) que se mutan directamente y se vuelven a pintar en pantalla.

Esta decisión de arquitectura es deliberada para un prototipo de demostración (permite entregarlo como un solo archivo, sin instalación ni infraestructura), pero tiene una implicancia central que atraviesa todo el documento: **nada persiste**. Cerrar o recargar la pestaña del navegador borra todos los cambios y vuelve a la fotografía inicial de datos de demostración.

### 2.2 Patrón de estado y renderizado

El patrón repetido en las más de cien funciones de interfaz es siempre el mismo:

1. Una acción del usuario (clic, envío de formulario) llama a una función que **valida** la operación contra las reglas de negocio vigentes.
2. Si la validación pasa, la función **muta** directamente el arreglo global correspondiente (agrega, edita o borra un registro) y registra el evento en `addContainerHistory()` cuando aplica.
3. Se llama a `renderDashboard()`, que vuelve a construir el HTML de la vista activa a partir del estado actual.

No hay un framework de componentes (React, Vue, etc.): cada pantalla es una función que devuelve una cadena de texto HTML gigante. Esto hace el código muy legible función por función, pero también significa que cualquier optimización de rendimiento a futuro (listas grandes, renderizado parcial) requeriría una reescritura, no un ajuste incremental.

### 2.3 Modelo de roles y navegación (RBAC simulado)

La navegación tiene tres vistas de primer nivel: **Catálogo** (público, cara al cliente B2B/B2C), **Dashboard** (panel interno) y **Esquema de base de datos** (vista didáctica que ilustra cómo se vería el modelo de datos en una base relacional real — no es el modelo de datos que usa el prototipo, es una simplificación con fines explicativos).

Dentro del Dashboard hay cinco roles seleccionables con un clic (no hay inicio de sesión real):

| Rol | Qué ve | Para qué sirve |
|---|---|---|
| **Administrador Total** | Inventario con costo real, analítica, trazabilidad de ventas/alquileres, gestión de personas (clientes, proveedores, colaboradores), Configuración | Visión de dueño del negocio |
| **Gerente de Ventas** | Reglas de margen/descuento, desempeño comercial del equipo, Configuración (compartida con Admin) | Define política comercial y mide al equipo |
| **Vendedor/Comercial** | Inventario de venta, bandeja de cotizaciones nuevas, seguimiento de cotizadas, contratos de alquiler | Operación comercial día a día |
| **Compras/Costos** | Facturas de compra, costos adicionales de terceros, nacionalización (DAM) | Operación de importación y costos |
| **Almacén/Operador** | Recepción e inspección, layout de patio, despachos | Operación física del patio |

Cambiar de rol es instantáneo y no restringe realmente el acceso a datos — es una maqueta de control de acceso (ver sección de implicancias) pensada para que un mismo demo muestre las cinco perspectivas del negocio.

### 2.4 Entidades núcleo del modelo de datos

| Entidad | Qué representa | Campos clave |
|---|---|---|
| `CONTAINERS` | Cada unidad física de contenedor | ISO, tipo, condición, estado comercial, posición de patio, costos, historial |
| `DEPOTS` | Los 4 depósitos (Callao, Ventanilla, Lurín, Paita) | tarifa diaria por TEU, ubicación |
| `PROVIDERS` | Terceros a quienes ZDRY les paga (fabricantes, agentes, transportistas) | tipo, tarifa, contacto |
| `CUSTOMERS` | Clientes de venta/alquiler/almacenaje | calificación de riesgo (A–D) |
| `QUOTES` | Cotizaciones de venta o alquiler | estado, unidades, historial |
| `RENTALS` | Contratos de alquiler vigentes o cerrados | tarifa mensual, plazo, cronograma de pagos |
| `DISPATCHES` | Despachos físicos (venta, alquiler o retiro de almacenaje) | camiones, guía, estado |
| `PURCHASE_INVOICES` | Facturas de compra/importación | Incoterm, logística, condiciones de pago adicionales |
| `PENDING_EXTRA_COSTS` | Cola de servicios de terceros reglados pero sin monto aún | proveedor sugerido, servicio |
| `INVOICES` | Costo de tercero ya registrado con monto | prorrateo, estado de pago |
| `FREIGHT_ZONES` / `TERRAIN_PROFILES` | Geografía y terreno para el motor de fletes | distancia, tipo de terreno |

### 2.5 Patrón transversal: reglas por especificidad jerárquica

Tres módulos distintos (precio de lista, visibilidad de precio al público, y tarifa de alquiler) resuelven sus valores con el **mismo patrón**: una lista de reglas con distinto alcance (global → tipo/categoría → fabricante/proveedor → contenedor específico), y siempre gana la regla más específica que aplique. Es una decisión de diseño consistente que vale la pena documentar como tal, porque cualquier extensión futura de "reglas configurables" en el sistema debería seguir el mismo patrón en vez de inventar uno nuevo.

---

## 3. Fases de desarrollo

### Fase 0 — Fundamentos: catálogos maestros y control de acceso

**Objetivo de negocio:** tener un vocabulario común (tipos de contenedor, condiciones, depósitos, roles) antes de registrar cualquier transacción.

**Funciones y datos clave:** `TYPES` (9 tipos: 20', 40', 40HC, 45HC, Open Top, Flat Rack, Hardtop), `CATEGORIES` (4 condiciones comerciales: 1TRIP/nuevo, Cargo Worthy, Wind & Water Tight, As Is), `DEPOTS` (4 depósitos con su tarifa diaria por TEU), `ROLES` y el enrutador `renderDashboard()`.

**Casos de uso:** un administrador da de alta un nuevo depósito o un nuevo tipo de contenedor antes de empezar a operar en él; cualquier usuario cambia de rol para revisar el sistema desde otra perspectiva.

**Implicancias:** al no haber autenticación real, esta fase es una maqueta de RBAC — útil para demostrar el producto a distintas audiencias en una sola sesión, pero **no reemplaza un control de acceso real** (ver sección 5).

---

### Fase 1 — Compras e ingreso de inventario

**Objetivo de negocio:** registrar cada unidad que ZDRY compra o importa, con su costo real y sus obligaciones de nacionalización, sin depender de cálculos manuales en una hoja de cálculo aparte.

**Funciones clave:**
- **Validación ISO 6346** (`parseIso6346`, `iso6346CheckDigit`): valida en vivo que el código de cada contenedor tenga el formato correcto (3 letras + U + 6 dígitos) y calcule el dígito de control con el algoritmo real de la norma — no es una validación de apariencia, es el cálculo matemático estándar de la industria. Si el dígito no coincide, el sistema sugiere la corrección o permite declarar el caso como excepción conocida.
- **Registro de factura de compra** (`submitPurchaseInvoice`, `generatePiRows`): cada factura puede traer contenedores de tamaños y precios distintos — no se prorratea un monto único entre unidades distintas.
- **Reglas automáticas de Incoterm y logística** (`PURCHASE_LOGISTICS_OPTIONS`, `defaultPurchaseExtras`): al elegir cómo se recibe la mercadería (el proveedor la entrega en el depósito de ZDRY, o ZDRY la recoge pagando flete y/o gate out), el sistema decide automáticamente cuáles de los siete servicios de terceros (agente de aduana, transporte, gate out, THC, agente portuario, vistos buenos, BL naviero) le corresponde pagar a ZDRY por esa compra en particular. El agente de aduana siempre es obligatorio.
- **Nacionalización / DAM** (`requiresNationalization`, `isNationalized`, `submitDam`): toda unidad importada necesita su Declaración Aduanera de Mercancías antes de poder despacharse; el sistema exige BL, Manifiesto y un número de DAM con formato válido.

**Casos de uso:**
1. Compras registra una factura de un proveedor chino con 3 unidades de 40' nuevas, en modalidad "recojo con flete y gate out" — el sistema marca automáticamente que transporte y gate out se pagarán aparte, y deja pendiente solo poner el monto cuando llegue la factura real del transportista.
2. Un contenedor llega con un código que no pasa el dígito de control — el operador corrige o declara el caso como excepción documentada, sin bloquear el registro indefinidamente.
3. Compras intenta autorizar el despacho de una unidad importada sin DAM — el sistema lo bloquea en la fase de Despachos (ver Fase 5).

**Reglas de negocio críticas:** ISO duplicado o inválido bloquea el registro; el agente de aduana nunca puede desmarcarse; la logística de entrega es la única fuente de verdad de qué se paga aparte (no se declara manualmente servicio por servicio salvo los casuísticos).

**Implicancias:** el modelo de condiciones de pago adicionales queda **reglado por Incoterm/logística en vez de por texto libre**, lo que reduce el margen de error humano al registrar una compra, pero también significa que cualquier logística nueva que el negocio empiece a usar requiere actualizar esta regla en el código (no hay un editor visual del árbol de decisión).

---

### Fase 2 — Recepción y patio (Almacén)

**Objetivo de negocio:** que cada unidad física tenga una ubicación real y verificable en el patio, respetando las restricciones físicas reales de un depósito de contenedores.

**Funciones clave:**
- **Recepción e inspección unificadas** (`almacenRecepcionHubHtml`): un solo flujo con tres entradas (unidad pendiente de una compra, ingreso nuevo sin registro previo, o devolución de un alquiler), con checklist de 9 fotografías y video de 360°.
- **Motor de ubicación de patio** (`sizeGroup`, `newnessTier`, `columnCompatible`, `columnUsable`, `nextNivelInColumn`, `bestSlotFor`): el corazón físico del módulo. Codifica cuatro reglas que replican cómo se apila realmente en un patio de contenedores:
  1. **Nunca se mezclan tamaños** (20'/40'/45') en una misma columna — son grupos completamente distintos.
  2. **Nuevo y usado no se mezclan** en la misma columna (regla activable/desactivable desde Configuración).
  3. **Gravedad**: no puede haber un contenedor en el nivel 3 sin uno debajo en el nivel 1 y 2 — siempre se apila en el siguiente nivel libre, nunca "flotando".
  4. **Orden de llenado**: una columna nueva de una ruma solo se habilita cuando la columna anterior está completamente llena — así se evita abrir columnas a medias mientras hay espacio disponible en la primera.
- **Custodia de terceros** (`intake_type="almacenaje_cliente"`): un cliente puede dejar su propio contenedor en el patio de ZDRY como servicio de almacenaje, con descuento pactado, y solicitar su retiro cuando quiera.
- **Unidad "comprometida"** (`containerCommitted`): una unidad ya vendida o alquilada sigue ocupando su posición física hasta que el despacho se completa de verdad — el patio no la libera antes de tiempo.

**Casos de uso:**
1. El stackero recibe una unidad y el sistema le sugiere automáticamente la mejor posición disponible que respeta las cuatro reglas físicas, priorizando completar columnas ya empezadas del mismo tamaño/condición.
2. Un cliente devuelve un contenedor alquilado con un golpe visible — el operador marca el defecto y el sistema genera automáticamente el cargo de reparación correspondiente.
3. Un cliente pide guardar temporalmente 5 contenedores propios — se registran como custodia, con su propio descuento de almacenaje, sin pasar por el flujo de compra.

**Reglas de negocio críticas:** las cuatro reglas físicas de apilamiento se aplican tanto en la asignación automática como en el movimiento manual de un contenedor; intentar violar cualquiera de ellas bloquea la acción con un mensaje explícito.

**Implicancias:** este módulo depende enteramente de que los datos de posición se mantengan siempre consistentes — cualquier proceso futuro que asigne posiciones (por ejemplo, una migración de datos históricos) **debe** pasar por el mismo validador (`bestSlotFor`) y no por asignación directa de coordenadas, para no reintroducir contenedores mal ubicados.

---

### Fase 3 — Comercial: cotizaciones y ventas

**Objetivo de negocio:** convertir inventario disponible en ingresos, con control de márgenes y visibilidad de precios.

**Funciones clave:**
- **Ciclo de vida de una cotización** (`QUOTES`, estados `Nueva → Cotizada → Ganada/Perdida`): idéntico para ventas y alquileres, diferenciados solo en qué se negocia.
- **Reglas de precio y visibilidad** (`PRICING_RULES`, `VISIBILITY_RULES`, resolución jerárquica): definen el precio de lista, el precio mínimo autorizado, y si el catálogo público muestra el precio o "Solicitar precio".
- **Bandeja de cotizaciones** (`respondQuote`): el vendedor no puede enviar una venta por debajo del precio de lista sin que el sistema se lo impida.
- **Servicios comerciales adicionales** (`COMMERCIAL_SERVICES`): catálogo de precio fijo (pintado, sellado, transporte adicional, fumigación) — nunca texto libre, siempre un precio ya aprobado por el negocio.
- **Cotizador de flete integrado** (ver Fase 6) dentro de la misma pantalla de seguimiento.
- **Documento de cotización en PDF** generado por el propio sistema, sin depender de una herramienta externa.

**Casos de uso:**
1. Un cliente pide precio de un 40' HC desde el catálogo público — si la regla de visibilidad lo permite, ve el precio directamente; si no, debe dejar sus datos para que el vendedor lo contacte.
2. El vendedor arma una cotización con dos contenedores más el servicio de transporte y el flete calculado — el sistema no deja avanzar si el margen del flete es menor al mínimo aceptable.
3. La cotización se marca "Perdida" con motivo obligatorio, quedando en el historial para análisis posterior.

**Reglas de negocio críticas:** precio de venta nunca por debajo del precio de lista sin autorización explícita de una regla más específica; el margen mínimo de flete bloquea el envío si no se cumple.

**Implicancias:** el control de descuentos vive enteramente en reglas configurables por quien tenga acceso a Configuración — es una fortaleza (evita hojas de cálculo paralelas) pero también un punto único de fallo: quien edite mal una regla global afecta todo el catálogo de inmediato, sin flujo de aprobación.

---

### Fase 4 — Alquileres y seguimiento de contratos

**Objetivo de negocio:** que un contenedor pueda generar ingreso recurrente, con seguimiento formal de pagos mes a mes.

**Funciones clave:**
- **Tarifa de alquiler** (`suggestedMonthlyRent`, `rentalRateFor`): se sugiere a partir del costo de adquisición, la depreciación esperada y el margen objetivo, ajustada por el plazo del contrato (a mayor plazo, mayor descuento) y por la calificación de riesgo del cliente (A–D: de descuento a recargo).
- **Cronograma de pagos** (`buildPaymentSchedule`): genera una cuota por cada mes del contrato, con la primera cuota por adelantado.
- **Estado de mora en vivo** (`paymentEffectiveStatus`): una cuota se marca "Atrasado" automáticamente comparando su fecha de vencimiento contra la fecha actual — no requiere que nadie la marque manualmente, ni corre un proceso batch nocturno.
- **Firma de conformidad del contrato** (`signRentalContract`).
- **Servicios adicionales del contrato**: se pueden cobrar de una sola vez o financiarse prorrateados con interés en las cuotas restantes.
- **Devolución**: reingresa la unidad a Almacén con checklist fotográfico y libera/reubica su posición en el patio automáticamente.

**Casos de uso:**
1. Un cliente de riesgo "A" (bajo riesgo) firma un contrato de 12 meses — obtiene automáticamente el descuento por plazo largo más el descuento adicional por buen historial.
2. El gerente revisa la cartera de alquileres y ve, sin intervención manual, cuántas cuotas están atrasadas en cada contrato al día de hoy.
3. Un cliente pide agregar un servicio de rotulado a mitad de contrato y prefiere no pagarlo de una vez — se financia con interés en las cuotas que faltan.

**Reglas de negocio críticas:** el estado de mora es siempre calculado, nunca almacenado como un valor fijo que pueda desincronizarse; la tarifa final combina tres factores automáticos (base, plazo, riesgo) sin negociación libre fuera de esas reglas salvo que exista una regla fija más específica.

**Implicancias:** al no persistir el estado de mora, cualquier reporte histórico de "cuántas cuotas estuvieron atrasadas en tal fecha pasada" no es reconstruible tal cual estaba ese día — el sistema solo sabe el estado *actual* recalculado contra la fecha de hoy.

---

### Fase 5 — Logística de despachos

**Objetivo de negocio:** que la salida física de un contenedor (por venta, alquiler o retiro de almacenaje) quede completamente trazada y no pueda saltarse ningún control documentario.

**Funciones clave:**
- **Motor único de despacho** (`DISPATCHES`, `reason` = venta/alquiler/almacenaje): los tres motivos comparten exactamente el mismo flujo de camiones, fotos, guía y salida, en vez de tener tres procesos distintos.
- **Despachos parciales**: una misma cotización o contrato puede despacharse en varios camiones y en fechas distintas, cada uno programado y verificado de forma independiente.
- **Verificación del camión** (`verifyTruck`): exige 5 fotografías, número de precinto y el nombre de quien corrobora antes de continuar.
- **Autorización de guía** (`authorizeGuia`): **bloquea la emisión de la guía si alguna unidad asignada no está nacionalizada** — es el punto donde la Fase 1 (nacionalización) y la Fase 5 se conectan de forma dura.
- **Salida física** (`markDispatched`): exige guía autorizada y nombre del vigilante de puerta; solo entonces libera la posición de patio y actualiza el estado comercial final del contenedor.

**Casos de uso:**
1. Una venta de 3 unidades se despacha en 2 camiones distintos, en días distintos, sin que uno bloquee al otro.
2. Se intenta autorizar la guía de una unidad importada que aún no tiene DAM — el sistema lo impide y señala exactamente qué falta.
3. El vigilante de puerta confirma la salida física — recién ahí el contenedor deja de "ocupar" su posición en el patio.

**Reglas de negocio críticas:** ninguna guía se autoriza sin nacionalización completa; ninguna salida física se marca sin guía autorizada; una unidad no puede asignarse a dos despachos activos al mismo tiempo.

**Implicancias:** este es el módulo con más controles duros de todo el sistema — refleja que, operativamente, el despacho mal documentado es el mayor riesgo legal/aduanero del negocio real. Cualquier cambio a este flujo debería revisarse con especial cuidado porque protege contra despachos indebidos.

---

### Fase 6 — Motor de fletes inteligente

**Objetivo de negocio:** cotizar el transporte de un contenedor a cualquier destino sin depender de una tabla fija de precios por zona, que quedaría obsoleta o incompleta.

**Funciones clave:**
- **Distancia real aproximada** (`haversineKm`, `estimateRouteDistanceKm`): calcula la distancia en línea recta entre origen y destino, y la ajusta con un factor de ruta específico por tipo de terreno (una ruta de sierra o selva es más larga en carretera que en línea recta).
- **Detección de terreno** (`routeTerrainKey`): usa el terreno del extremo que no es un depósito propio de ZDRY (los depósitos no tienen terreno propio).
- **Perfiles de terreno** (`TERRAIN_PROFILES`: urbano, costa, sierra, selva): cada uno con su propia velocidad promedio y tarifa por kilómetro/hora — modela que sierra y selva son más lentos y caros, no solo más distantes.
- **Cálculo de camiones necesarios** (`trucksNeededFor`): un camión lleva un 40'/45', o hasta dos 20' — nunca se cobra flete lineal por unidad sin considerar esto.
- **Tres niveles de margen** (mínimo, recomendado, premium) sugeridos automáticamente sobre el costo estimado.

**Casos de uso:**
1. Un cliente en Cusco pide flete para un 40' — el sistema detecta terreno de sierra, calcula más horas de ruta que a un destino de costa a la misma distancia en línea recta, y sugiere un precio con margen.
2. Un vendedor cotiza flete para recoger un contenedor de alquiler desde la ubicación del cliente — el terreno relevante es el de origen (donde está el cliente), no el del depósito de destino.

**Reglas de negocio críticas:** no se permite agregar el ítem de flete a una cotización si el precio no cubre el margen mínimo configurado.

**Implicancias — la más importante del sistema:** este motor es una **aproximación matemática (haversine + factor de ruta), no una distancia real de un proveedor de mapas**. Está diseñado deliberadamente para ser reemplazado por una API real (Google Maps Distance Matrix u otra) sin tener que rediseñar el resto del motor de costos — el propio código lo documenta así. Antes de usar estos precios de flete en producción, el negocio debería validar contra distancias reales, especialmente en rutas de sierra y selva donde el error de una aproximación en línea recta es mayor.

---

### Fase 7 — Costos adicionales y gestión de facturación de terceros

**Objetivo de negocio:** que cada sol que ZDRY le debe a un tercero (agente de aduana, transportista, agente portuario, etc.) quede registrado, distribuido correctamente entre las unidades que corresponde, y con seguimiento de si ya se pagó o no.

**Funciones clave:**
- **Cola de pendientes por regla de compra** (`PENDING_EXTRA_COSTS`, ver Fase 1): la factura de compra decide *qué* se paga aparte; esta cola es donde se completa *cuánto* y *a quién*, cuando la factura real del proveedor llega — que puede ser semanas o meses después de la compra.
- **Registro libre de costos** (`comprasExtraHtml`): para gastos que no vienen de una regla de compra (reparaciones, almacenaje previo, inspección adicional).
- **Cinco métodos de distribución del costo entre unidades**: equitativo, por TEU (un 20' paga la mitad que un 40'), por volumen (CBM), fijo por unidad (el mismo monto a cada una, sin dividir), o el 100% a una sola unidad.
- **Seguimiento de pago a terceros** (`markInvoicePaid`/`markInvoiceUnpaid`): cada costo de tercero queda "Pendiente de pago" hasta que se marca explícitamente como pagado, con su propia fecha y número de factura del proveedor.
- **Estado agregado por servicio** (`purchaseExtraStatus`): incluido/no aplica → pendiente de registrar → registrado sin pagar → pagado.

**Casos de uso:**
1. Se compra un lote con logística de recojo — el sistema deja en cola "Transporte" y "Gate Out" como pendientes; un mes después llega la factura del transportista, y solo hace falta poner el proveedor (ya sugerido) y el monto.
2. Un costo de flete se distribuye por TEU entre un 20' y un 40' de la misma factura — el 40' paga el doble.
3. El área de Compras revisa qué facturas de terceros siguen sin pagarse, filtrando por factura de compra de origen.

**Reglas de negocio críticas:** el monto nunca se pide en el momento de la compra (evita bloquear el registro de la compra por un dato que aún no existe); el agente de aduana siempre genera un costo (nunca es "no aplica").

**Implicancias:** este módulo modela cuentas por pagar a terceros de forma razonablemente completa (monto, proveedor, prorrateo, estado de pago), pero no incluye conciliación bancaria, retenciones tributarias ni integración contable — es trazabilidad operativa, no un módulo de contabilidad.

---

### Fase 8 — Administración y configuración centralizada

**Objetivo de negocio:** que las reglas que gobiernan precio, patio, alquiler y proveedores vivan en un solo lugar administrable, en vez de dispersas o *hardcodeadas*.

**Funciones clave:** panel único de Configuración (visible solo a Administrador y Gerente) con: visibilidad de precios, tarifario completo de fletes, reglas de alquiler (depreciación, márgenes, descuentos por plazo/riesgo), reglas de columna de patio (niveles mínimo/máximo, agrupación por condición/fabricante), catálogo de proveedores y servicios, y la flota propia de camiones.

**Casos de uso:**
1. El gerente decide que a partir de ahora también se agrupe por fabricante en el patio (no solo por tamaño y condición) — lo activa desde Configuración sin tocar código.
2. Se da de alta un nuevo camión de la flota propia, con validación automática de que no se le asigne dos despachos el mismo día.

**Reglas de negocio críticas:** no se puede eliminar la última regla global de precio o visibilidad (siempre debe existir un valor por defecto); no se puede eliminar un proveedor o tipo que esté en uso.

**Implicancias:** centralizar la configuración reduce inconsistencias, pero también significa que un cambio aquí es inmediato y global — no hay entorno de pruebas separado, ni versionado de reglas, ni capacidad de revertir un cambio a una fecha anterior.

---

### Fase 9 — Reportes, analítica y trazabilidad

**Objetivo de negocio:** que el negocio pueda ver, sin pedir un reporte aparte, cómo está el inventario, cómo va el equipo comercial y qué pasó con cada contenedor a lo largo de su vida.

**Funciones clave:**
- **Analítica de inventario**: precio promedio por tamaño/categoría/proveedor, días de estadía promedio, matriz de stock por depósito × tamaño/tipo o × condición (con selector entre ambas vistas), y evolución semanal de ventas/alquileres/reposición — todo con gráficos SVG dibujados por el propio sistema, sin librerías externas.
- **Trazabilidad completa por contenedor** (`containerFullReportHtml`): reporte imprimible/descargable con toda la bitácora cronológica de un contenedor desde su ingreso hasta su estado actual, incluidas las fotos de cada etapa.
- **Desempeño comercial**: tiempo de respuesta, cotizaciones cerradas/perdidas y cumplimiento de meta, tanto por vendedor individual como para todo el equipo.

**Casos de uso:**
1. El gerente revisa qué proveedor tiene el precio promedio más alto por tamaño de contenedor antes de negociar el próximo lote.
2. Un cliente reclama por el estado de un contenedor recibido — se imprime su trazabilidad completa con fotos de cada etapa para resolver la disputa.

**Implicancias:** los reportes son siempre "en vivo" sobre el estado actual de las variables JS — no hay fotos históricas de reportes pasados ni exportación a un almacén de datos separado; cerrar la sesión pierde la posibilidad de reconstruir un reporte de una fecha anterior salvo que ya se haya descargado.

---

### Fase 10 — Datos de demostración y aseguramiento de calidad

**Objetivo de negocio:** que cualquier persona que abra el prototipo vea de inmediato un negocio con volumen y variedad reales, sin tener que cargar datos a mano, y que cada cambio nuevo no rompa lo que ya funcionaba.

**Funciones clave:**
- **Semilla de datos**: 17 contenedores iniciales más una simulación de 6 meses de operación (`seedSixMonthOperatingHistory`) que genera alrededor de 35 unidades adicionales, 9 facturas de compra, 24 cotizaciones (12 de venta y 12 de alquiler) cubriendo cada estado posible del ciclo de vida, y clientes ficticios adicionales. Al cierre de la simulación se aplica una compactación de patio para garantizar que ninguna posición quede físicamente inconsistente.
- **Suite de pruebas automatizadas**: 21 archivos de prueba con Playwright (`functional_test7`…`functional_test24`) más una prueba de humo (`smoke_full7`) que recorre los cinco roles. Cada archivo abre el prototipo como si fuera un usuario real, navega, hace clic, llena formularios y verifica que el resultado sea el esperado y que no aparezcan errores de consola.

**Casos de uso:** antes de entregar cualquier cambio, se ejecuta la suite completa de pruebas para confirmar que ninguna regla de negocio existente se rompió con la nueva funcionalidad.

**Implicancias:** la cobertura de pruebas es de **flujo de interfaz** (¿la pantalla hace lo que debe cuando un usuario interactúa con ella?), no de unidad aislada de cada función ni de carga/rendimiento — es apropiada para un prototipo de este tamaño, pero no sustituye pruebas de carga ni de seguridad antes de producción.

---

## 4. Matriz de reglas de negocio críticas

Estas son las reglas que el sistema **bloquea o calcula automáticamente** — no sugerencias de interfaz, sino lógica que se ejecuta siempre:

| # | Regla | Módulo | Consecuencia si se viola |
|---|---|---|---|
| 1 | Código ISO 6346 con dígito de control válido | Compras | Bloquea el registro salvo excepción declarada |
| 2 | ISO duplicado | Compras / Almacén | Bloquea el registro |
| 3 | Nacionalización (DAM) completa | Compras → Despachos | Bloquea la autorización de guía |
| 4 | Precio de venta ≥ precio de lista | Comercial | Bloquea el envío de la cotización |
| 5 | Margen mínimo de flete | Comercial / Fletes | Bloquea agregar el ítem a la cotización |
| 6 | Mismo tamaño en una columna de patio | Almacén | Bloquea la ubicación física |
| 7 | Mismo nuevo/usado en una columna (si está activo) | Almacén | Bloquea la ubicación física |
| 8 | Apilamiento contiguo (sin huecos) | Almacén | Bloquea el nivel solicitado |
| 9 | Columna siguiente solo si la anterior está llena | Almacén | Bloquea la columna |
| 10 | Camión de flota sin doble asignación el mismo día | Despachos | Bloquea la asignación |
| 11 | Unidad no asignable a dos despachos activos a la vez | Despachos | Bloquea la asignación |
| 12 | Checklist de verificación del camión completo | Despachos | Bloquea marcar "verificado" |
| 13 | Guía autorizada antes de la salida física | Despachos | Bloquea "salida física" |
| 14 | Reserva de 48h auto-expira | Comercial | Libera la unidad automáticamente |
| 15 | Estado de mora de alquiler siempre recalculado en vivo | Alquileres | Nunca queda un estado "atrasado" desactualizado |
| 16 | Siempre debe existir una regla global de precio/visibilidad | Configuración | No permite eliminar la última |
| 17 | No se elimina un proveedor/tipo en uso | Configuración | Bloquea la eliminación |

---

## 5. Implicancias generales del prototipo

El propio sistema declara en su pie de página qué está simulado: *cobro con tarjeta, envío de correo, facturación electrónica SUNAT y distancia real de flete (Google Maps)*. El resto de la lógica de negocio — reglas de precio, control de acceso por rol, multi-depósito, IGV, prorrateo de costos, facturas de compra, ubicación de patio, generación de PDF, inspección y stock — corre de verdad dentro del archivo, con datos reales de la sesión.

Para pasar de este prototipo a un sistema de producción, las brechas principales a resolver son:

- **Persistencia real**: hoy todo vive en memoria del navegador. Se necesita una base de datos y una API que respalden cada una de las entidades descritas en la sección 2.4.
- **Autenticación y control de acceso real**: el cambio de rol con un clic debe convertirse en un inicio de sesión real, con permisos verificados en el servidor, no solo en la interfaz.
- **Multiusuario y concurrencia**: dos personas trabajando al mismo tiempo hoy se pisarían sin saberlo (no hay bloqueo de registros ni sincronización); en producción se necesita resolver condiciones de carrera, sobre todo en la asignación de posiciones de patio y en la reserva de unidades.
- **Integraciones reales**: pasarela de pago, envío de correo/WhatsApp, facturación electrónica ante SUNAT, y un proveedor real de distancias (Google Maps u otro) para el motor de fletes — todas están diseñadas para conectarse sin rediseñar la lógica que ya existe, pero hoy son simulaciones locales.
- **Almacenamiento de archivos**: las fotos y videos se guardan como texto codificado dentro del propio estado en memoria — en producción necesitan ir a un almacenamiento de archivos real (por ejemplo, un bucket de objetos), no viajar embebidos en cada registro.
- **Auditoría y seguridad**: al no haber backend, no hay registro de quién hizo qué cambio a nivel de sistema (solo la bitácora de negocio dentro de cada contenedor/cotización) ni protección contra manipulación directa del estado desde la consola del navegador.

Ninguna de estas brechas invalida el valor del prototipo: la lógica de negocio, las reglas de validación y los flujos de trabajo ya están diseñados, probados y documentados en este archivo. El trabajo de producción es principalmente de **infraestructura y seguridad alrededor de una lógica de negocio que ya funciona**, no de rediseño de las reglas mismas.

---

## 6. Cobertura de pruebas

La calidad del prototipo se sostiene con 21 archivos de prueba automatizada (Playwright) más una prueba de humo que recorre los cinco roles sin errores. Cada archivo simula a un usuario real abriendo el prototipo, navegando por sus pantallas y verificando que la interfaz responda como se espera — incluyendo los casos de rechazo (por ejemplo, que el sistema efectivamente bloquee un ISO inválido, o que efectivamente impida autorizar una guía sin nacionalización). Antes de cada entrega de una nueva funcionalidad se ejecuta la suite completa para confirmar que nada de lo ya construido se rompió.

Esta cobertura es de **comportamiento de extremo a extremo** (¿la pantalla hace lo correcto cuando un usuario interactúa con ella?) y no de pruebas unitarias aisladas ni de carga — suficiente para la velocidad de iteración de un prototipo, insuficiente por sí sola antes de un lanzamiento en producción.

---

## 7. Glosario

- **TEU**: *Twenty-foot Equivalent Unit* — unidad de medida basada en un contenedor de 20 pies; un contenedor de 40'/45' equivale a 2 TEU.
- **Incoterm**: término comercial internacional que define qué tramo del transporte y qué costos asume cada parte en una compra internacional (EXW, FOB, CFR, CIF, DAP, DDP).
- **DAM**: Declaración Aduanera de Mercancías — el documento que nacionaliza una importación en el Perú y habilita su libre disposición.
- **ISO 6346**: norma internacional que define el formato del código identificador de un contenedor marítimo, incluido su dígito de control matemático.
- **Ruma / Columna / Nivel**: la unidad de organización física del patio — una ruma es una fila de columnas, cada columna se apila en niveles.
- **RBAC**: *Role-Based Access Control* — control de acceso basado en roles (en este prototipo, simulado en la interfaz, no aplicado a nivel de servidor).
- **1TRIP / CW / WWT / ASIS**: condiciones comerciales de un contenedor usado, de mejor a más desgastado — 1TRIP (un solo viaje, prácticamente nuevo), Cargo Worthy, Wind & Water Tight, As Is.

---

*Documento generado a partir de una lectura completa del código fuente del prototipo (`zdry_prototype.html`) y de la evolución funcional acumulada a lo largo de las rondas de desarrollo del proyecto.*

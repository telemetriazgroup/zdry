# Estatus ZDRY

Referencia de trabajo. Lectura del repo el **3 de noviembre de 2026**. La fuente de verdad es el código de la rama `prueba_1` (`ab3676a`, 29-oct-2026). Varias fichas quedaron atrás; este archivo dice cuál creer.

Árbol de trabajo limpio. `main` está en `a31a4e2` («ordenando sin desarrollo logos ok») y no incluye este desarrollo. 86 commits. No hay workflow de CI en `.github`.

---

## Qué es

Sistema operativo de **venta y alquiler de contenedores DRY** (Z Group, Perú). ZDRY lleva patio, fotos, evaluación, catálogo y la negociación. **Odoo 17** lleva la orden, la factura SUNAT y la GRE. ZDRY no habla con SUNAT ni cobra con pasarela: el cliente paga por transferencia y un comercial valida el comprobante.

Plan original: `proyecto_zdry.md` (v1.1, 31-ago-2026). El producto real se desvió hacia **asimilar el patio que ya está en Odoo**, regularizarlo en campo y cotizar con el PDF de Odoo. El prototipo HTML dejó de ser la hoja de ruta diaria.

---

## Stack

| Pieza | Dónde |
|---|---|
| API | NestJS 11, Prisma 6, PostgreSQL 16. `apps/api`. Puerto 3003 |
| Web | React 19, Vite 7, React Router 7. `apps/web`. Base `/zdry/` |
| Datos | Postgres host `localhost:5435`. Redis 7. Archivos en SeaweedFS (S3) `:8333` |
| Correo de desarrollo | Mailhog `:8025` |
| App | `docker compose up --build` → http://localhost:28080/zdry/ |
| Dominio | `apps/api/src/domain` (~70 módulos, 64 `*.spec.ts`). `cd apps/api && npm test` |
| Migraciones | 55, del `20260831` al `20261029` |

Roles en Prisma: `superadmin`, `admin`, `gerente`, `vendedor`, `ejecutivo`, `compras`, `coordinador`, `almacen`, `cliente`. Seed y clave de desarrollo: `usuarios_prueba.md` (`Zdry123!`). El vendedor no recibe FOB ni `C_T`.

Rutas públicas: `/` catálogo, `/c/:shareToken` enlace, `/e/:token` ficha enviada, `/acceso` portería del enlace, `/visita` transportista, `/legal/:slug`, `/login`, `/mi-cuenta`.

---

## Veredicto

**Operable en patio piloto DRY, no cerrado para go-live.**

Se puede: conectar Odoo, bajar lotes a la mano, asimilar, mandar a campo, inspeccionar, publicar al catálogo, compartir un enlace con vigencia, cotizar en Odoo (borrador, PDF Perú v2, pedido, enmienda, confirmación de venta y de alquiler) y ver ventas realizadas / estadística DRY.

No se puede tratar como el ERP del plan maestro: despacho de patio (guía, flota, precinto) sigue bloqueado, el flete es una tabla de kilómetros, no hay Maps, no hay suite E2E conjunta, no hay checklist de producción (TLS, backup ensayado, usuarios reales, carga). El delta continuo Odoo → ZDRY (J6) no está.

El frente de las últimas dos semanas (17–29 oct) es **comercial de catálogo**: enlaces, condición por evaluación, ventas realizadas, rol ejecutivo, cambio de clave obligatorio, y salida de avisos por WhatsApp/correo vía SGIT (`conexion_api_was_correo.md`, `SalidaService`).

---

## Capas, en el orden en que se construyeron

### 1. Plan maestro (sprints)

El calendario S0–S11 de `proyecto_zdry.md` no se siguió al pie. Lo que hay en código:

| Sprint | Tema | En código |
|---|---|---|
| 0–1 | Docker, auth, RBAC, maestros, auditoría | Hecho. Más roles de los cinco originales (`coordinador`, `ejecutivo`, `superadmin`) |
| 2 | Compras, ISO 6346, DAM, extras | Hecho. ISO inválido **no bloquea** el alta (excepción visible) |
| 3 | Recepción, 9 fotos, patio `bestSlotFor` | Hecho. Posición puede quedar pendiente |
| 4 | Catálogo, reserva, voucher, cierre comercial | Hecho en ZDRY y, encima, empujado a Odoo (ver Q) |
| 5 | Alquiler con mora viva y contrato | Parcial. `rent_issue` / `rent_close` en Odoo. No es el módulo de contrato/mora del sprint |
| 6 | Despachos (guía, flota, vigilante) | **No.** `/app/almacen/despachos` dice «Restringido» |
| 7 | Fletes | Stub. `freight-stub.ts`: zonas con km fijos, sin `DistanceProvider` ni Maps |
| 8 | CxP de compra y prorrateo | Parcial. Costos de patio (Gate-In, lavado, movimiento) sí. Queda un texto de servicio que aún dice «Sprint 8» en `warehouse.service.ts` |
| 9 | Config, analítica, equipo | Config y precios sí. Estadística DRY y ventas realizadas sí. «Desempeño del equipo» es `ComingSoon` |
| 10 | Odoo real, correo, Maps, WhatsApp | Odoo real sí. Correo/WhatsApp salen por SGIT, no por SMTP propio ni Cloud API. Maps no |
| 11 | Carga, concurrencia, go-live | No. Checklist §15 de `proyecto_zdry.md` sigue abierto |

### 2. Lectura Odoo (F0–F5)

`fase_integracion_odoo.md`. Hecho y en uso.

Conexión superadmin, bandeja de candidatos (`OdooLotCandidate`), asimilar a `Container` sin exigir ISO, depósito creado desde la ubicación Odoo, ficha con write-back diferido, deuda de OC, evaluación de piso/techo/puertas/pintura, marca de agua de catálogo. El operario de campo no ve Odoo ni precios.

### 3. Reentrega y puerta (plan de ajuste A–F)

`plan_ajuste.md` + `modificaciones_zry.md`. Migración `20260908120000_plan_ajuste`. Hecho.

Coordinador habilita; campo toma fotos y diagnostica (incluye hueco de techo); coordinador asigna casillas y documentos; admin publica. Visita pública por placa de tracto (`/visita`, `GateVisit`). Costos de patio sin monto para el coordinador (`DepotCostConcept`, `DepotCostEntry`). Documentos de unidad aparte de las 9 fotos (`ContainerDocument`).

### 4. Plan conjunto J0–J6

`docs/fases_conjunto/README.md` está **vencido** en J4 y J5. Estado según código:

| Fase | Ficha | Código al 3-nov-2026 |
|---|---|---|
| J0 | Hecha | Contrato y plan |
| J1 | Hecha | Origen de costo (ajuste vs IN) y precio referencial. Correcciones OC y fabricación aparte |
| J2 | Cerrada 19-sep | Webhook `zdry.sync.event`, expediente |
| J3 | Cerrada 20-sep | Conciliar reentrega ↔ OC/IN. Pantalla Compras → Conciliar |
| J4 | La ficha dice «en curso» y los checks siguen vacíos | **Implementada en local.** Migración `20260920180000_j4_foto_unica`. `POST /warehouse/units/:iso/odoo-ref`. Spec `odoo-ref-photo.spec.ts`. Una JPEG `zdry_ref` al lote; el resto se queda en el almacén S3 |
| J5 | La ficha dice que `sale_close` es un log | **Superada por la ruta Q.** Ver abajo. No usar la ficha J5 ni `docs/cotizacion_dry.md` ni `docs/datos_dry.md` para el estado del worker |
| J6 | Pendiente | Sigue pendiente: `quant_change` automático, recálculo al `bill_posted`, E2E Playwright + Odoo, checklist de go-live, pentest del webhook |

### 5. Cotización que nace en ZDRY (Q0–Q7)

Canónico de estado: `docs/ruta_cotizacion_zdry.md` («Q0–Q7 hechos»). Migraciones `20260921140000` … `20260921190000`.

| Paso | Qué hace |
|---|---|
| Q0 | Probe de maestros Odoo |
| Q1 | Cliente sin RUC; consulta SUNAT vía Odoo (`zdry_lookup_sunat`) |
| Q2 | Partner + `sale.order` en **borrador**. No confirma |
| Q3 | PDF del reporte Perú v2 al almacén S3 |
| Q4 | El voucher se ata a `odooSaleName`. **No** encola `sale_close` |
| Q4b | Enmienda del borrador. 409 si la SO ya está en `sale` |
| Q5 | Worker `SaleCloseWorker` (cada 12 s) **confirma** la SO. No valida el OUT |
| Q6 | Alquiler: `rent_issue` / `rent_close` (servicio + ISO a 0 + plan). No es el patrón de venta |
| Q7 | Timeline y `QuoteOdooRevision` (origen `zdry` u `odoo`) |

`OdooClient.enqueueSaleClose` sigue siendo un log. El cierre real no pasa por ahí: lo hace `apps/api/src/odoo-import/sale-close-worker.service.ts`.

Puente Odoo citado en la ruta: **17.0.1.5.0**. El módulo vive en el repo Odoo (`zgroup/documentacion/fases/`), no en este.

### 6. Catálogo comercial (octubre)

Encima de Q, y es el trabajo más reciente:

- Enlaces con vigencia (24–240 h), RUC, DNI, código, sesión, origen del share (`CatalogShare`).
- Portería `/acceso`: reabre un enlace vencido 30 minutos.
- Excepciones de precio, handoff, copia de textos.
- Evaluación por puntos (malo 1, regular 2, bueno 4, excelente 5) que puede subir la condición **de oferta** sin pisar la documental. Un precio fijado a mano no se recalcula. El cliente ve dos condiciones (Nuevo & 1 trip / Segundo uso); el staff ve todas. Evoluciones 10 y 11 (`documentacion/incidente10.md`, `incidente11.md`).
- Ventas realizadas con desglose de extras por concepto y plaza Odoo (`odooWarehouse`), no por el nombre del patio. Incidente 01: Tracking Piura no entraba porque la plaza de costo seguía en `ZGROU`.
- Estadística DRY: archivo local de SO (venta / alquiler / otros).
- Rol `ejecutivo` (29-oct): inventario, enlaces y comerciales.
- Clave obligatoria al primer ingreso (`mustChangePassword`).
- Avisos de enlace por WhatsApp y correo. ZDRY no envía: hace `POST` a SGIT `https://ztrack.app/servicio/salida` con `x-salida-clave`. Canal configurable: ambos, correo, WhatsApp o ninguno. Prueba desde Configuración.

---

## Mapa de pantallas que importan

| Ruta | Quién | Estado |
|---|---|---|
| `/` y `/c/:token` | Público / cliente del enlace | Catálogo real |
| `/app` | Staff | Inicio por rol |
| `/app/almacen/odoo` | Admin, superadmin | Bandeja regularizar |
| `/app/almacen/recepcion` | Admin, coordinador | Ingreso, ficha, conciliación de fotos |
| `/app/almacen/campo` | Almacén, coordinador | Tomas y diagnóstico |
| `/app/almacen/visitas` | Coordinador | Puerta |
| `/app/almacen/patio` | Coordinador, almacén, admin | Layout |
| `/app/almacen/despachos` | Almacén | **Restringido** |
| `/app/catalogo-media` | Admin, gerente, compras | Publicar / ocultar |
| `/app/enlaces-catalogo` | Vendedor, ejecutivo, admin | Shares |
| `/app/bandeja` y hermanos | Según nav de quotes | Cotización, pagos, seguimiento |
| `/app/ventas-realizadas` | Admin | Cierres con costo |
| `/app/estadistica-dry` | Superadmin | Histórico Odoo |
| `/app/integraciones` | Superadmin | Credenciales Odoo |
| `/app/compras/*` | Compras, coordinador (conciliar) | Facturas, deuda, DAM, match |
| `/app/equipo` | Gerente | **ComingSoon**, sprint 9 |

Nav por rol: `apps/web/src/auth.jsx` (`ROLE_NAV`). El superadmin ve la unión de todos.

---

## Qué no reabrir

- Facturación SUNAT, GRE y pasarela dentro de ZDRY.
- Copiar el patrón de alquiler (servicio + línea a 0) dentro de `sale_close`.
- Video 360 hacia Odoo.
- Asignar x,y,z sin `bestSlotFor`.
- Mostrar FOB, `C_T` o ids Odoo a vendedor, campo o catálogo público.
- Tratar `docs/fases_conjunto/README.md`, `J4-foto-unica.md` (checks), `J5-cierre-comercial.md`, `docs/cotizacion_dry.md` y `docs/datos_dry.md` como estado actual del cierre comercial. Esos textos describen el diseño de septiembre. La ruta Q y los workers son posteriores.

`README.md` dice «siguiente = J1». Tampoco es el estado.

---

## Huecos, en orden de producto

1. **J6.** El patio no se mantiene solo: sigue habiendo «Buscar en Odoo». Falta aviso de quant en 0, E2E conjunto y checklist de `implicancias`.
2. **Despachos de salida (sprint 6).** Guía, DAM bloqueante, precinto, flota, liberación de slot al salir. La salida física hoy se entera por Odoo (OUT), no por un módulo ZDRY.
3. **Flete real (sprint 7) y Maps.** El stub cotiza; no es tarifa de camino.
4. **Go-live.** Sin CI, sin ensayo de restore como puerta de salida, secretos de compose por defecto (`JWT_SECRET`, clave S3, seed).
5. **Equipo (sprint 9)** y el prorrateo fino de CxP que el plan llamaba sprint 8, si el negocio lo sigue pidiendo.
6. **WhatsApp de negociación** (plan WA de `docs/datos_dry.md`) no es el canal SGIT ya conectado. SGIT manda avisos; no hay bot de estado para el cliente.

---

## Cómo retomar

```bash
docker compose up --build
# web  http://localhost:28080/zdry/
# api  http://localhost:3003/health
cd apps/api && npm test
```

Usuarios: `usuarios_prueba.md`. Odoo se configura en Integración (superadmin), no hace falta para levantar el stack (`ODOO_ENABLED` default false).

Incidentes ya diagnosticados: `documentacion/incidente01.md` … `incidente11.md`. El número no se reutiliza. Del 01 al 09 son fallos; 08–11 mezclan evolución de catálogo (el README de esa carpeta los trata igual).

Al cambiar estado de una fase, actualizar **este archivo** y la ficha de la fase. No fiarse solo de los checks de septiembre.

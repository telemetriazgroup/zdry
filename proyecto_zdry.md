# ZDRY — Plan maestro de producto y desarrollo

**De prototipo HTML a sistema funcional en Docker**

| Campo | Valor |
|---|---|
| Producto | ZDRY — El supermercado de contenedores |
| Tagline de marca | VENTA Y ALQUILER DE CONTENEDORES |
| Fuentes | `zdry_prototype_26.html` · `ZDRY_Documentacion_Tecnica.md` · `LOGO_Z.png` |
| Versión del plan | 1.1 — 31 de agosto de 2026 |
| Alcance | Marketplace B2B/B2C + ERP operativo (compras, patio, comercial, alquileres, despachos, fletes, costos de terceros, reportes). Contabilidad y facturación vía **Odoo**. **No hay integración SUNAT** en ZDRY. |
| Destino | Sistema de producción contenedorizado (Docker Compose / Kubernetes-ready) |
| Mercado | Perú — contenedores marítimos (venta, alquiler, almacenaje, flete) |
| Cambio 1.1 | Cierre comercial por **comprobante + validación humana**; Odoo en lugar de SUNAT; canal de descuento **antes del pago** |

---

## 0. Cómo leer este documento

Este plan no es un rediseño del negocio: es la hoja de ruta para **portar la lógica ya demostrada** en el prototipo a un sistema persistente, multiusuario y seguro, **sin romper las pantallas ni las reglas** que el prototipo ya prueba.

Orden de lectura recomendado:

1. Evaluación del concepto (por qué el prototipo es válido y qué no puede seguir siendo).
2. Identidad visual y mapa de interfaces (qué se conserva del HTML y cómo entra el logo).
3. Arquitectura Docker y modelo de datos de producción.
4. Catálogo de casos de uso (qué debe poder hacer cada actor).
5. Conflictos y reglas de bloqueo (lo que el sistema debe impedir).
6. Sprints (qué se entrega, en qué orden y con qué criterio de “hecho”).

**Principio rector:** la lógica de negocio, las 17 reglas críticas y el diseño visual del HTML se conservan. Lo que se construye de cero es infraestructura, persistencia, autenticación real, concurrencia, almacenamiento de archivos e integraciones.

---

## 1. Evaluación del concepto

### 1.1 Qué es ZDRY

ZDRY no es un catálogo estático ni un Excel con cara web. Es un **marketplace operativo** para una empresa peruana que compra/importa contenedores, los nacionaliza, los ubica físicamente en patio, los vende o alquila, los despacha con guía y camión, cotiza flete y rastrea cada sol pagado a un tercero.

El prototipo cubre el ciclo completo:

```
Compra / importación → DAM / nacionalización → Recepción e inspección
        → Ubicación en patio → Cotización (venta o alquiler)
        → Reserva ─┬─ (opcional) hablar con comercial para descuento
                   └─ Cliente paga y sube comprobante
        → Comercial valida el pago (interbancario puede demorar)
        → Comercial confirma asignación + extras (movimientos, transporte)
        → Comercial programa el despacho
        → Sync a Odoo → Almacén ejecuta salida
```

Ese ciclo es el producto. El eslabón **comprobante → validación comercial → asignación → despacho** no es un extra: es el cierre real de la venta. Sin él el equipo mueve patio o cotiza flete a ciegas, y se asigna producto sobre un pago que todavía no está en la cuenta. Cualquier sprint que salte un eslabón deja un hueco operativo.

### 1.2 Fortalezas del prototipo (se conservan)

| Fortaleza | Por qué importa en producción |
|---|---|
| Reglas de negocio **bloqueantes**, no sugerencias | Evitan despachos ilegales, precios bajo lista y patio físicamente imposible |
| Patrón de reglas jerárquicas (global → tipo → fabricante → unidad) | Un solo mecanismo para precio, visibilidad y tarifa de alquiler |
| Motor de patio con 4 reglas físicas | Replica cómo se apila de verdad; no es un “depósito abstracto” |
| ISO 6346 con dígito de control real | Evita inventario fantasma y reclamos de identidad de unidad |
| Incoterm/logística como fuente de verdad de costos de terceros | Reduce error humano al registrar una compra |
| Un solo flujo de despacho para venta, alquiler y retiro de almacenaje | Menos procesos paralelos, menos fugas documentarias |
| Mora de alquiler recalculada en vivo | Nunca queda un estado “atrasado” desactualizado |
| Trazabilidad por contenedor con fotos | Defensa ante reclamos del cliente |
| Diseño visual ya validado (navy / naranja / cards / subtabs) | El equipo de producto no parte de un wireframe vacío |

### 1.3 Limitaciones que invalidan el prototipo como sistema

El prototipo es deliberadamente un SPA autocontenido. Eso es una virtud de demo y un **bloqueo de producción**:

| Limitación | Riesgo de negocio | Qué debe resolver el sistema |
|---|---|---|
| Estado en memoria JS; recargar borra todo | Pérdida total de operación | PostgreSQL + API |
| Roles con un clic, sin login | Cualquiera ve costos reales | Auth + RBAC en servidor |
| Un solo usuario implícito | Dos operadores se pisan el patio o la reserva | Locks, transacciones, optimistic concurrency |
| Fotos embebidas en el estado | El navegador no escala; no hay backup | Object storage (S3/MinIO) |
| Flete por haversine | Precio de transporte incorrecto en sierra/selva | API de distancias reales, con fallback |
| Pago con tarjeta y SUNAT simulados | El negocio real no cobra en pasarela ni factura desde ZDRY | **Comprobante + comercial + Odoo** (ver §1.5). ZDRY no se integra a SUNAT. |
| Sin auditoría de sistema | No se sabe quién cambió una regla de precio | Audit log inmutable |
| Pruebas solo E2E de UI | La lógica se puede romper al portar | Unit + API + E2E + tests de concurrencia |

**Conclusión:** el prototipo ya es la especificación ejecutable de negocio. El trabajo de producción es **envolver esa lógica** en servicios, no reinventar pantallas ni reglas.

### 1.4 Qué no entra en el MVP (y queda explícitamente fuera)

Para no inflar el primer go-live:

- Contabilidad general / asientos / conciliación bancaria **dentro de ZDRY** (eso vive en **Odoo**; ZDRY solo empuja el cierre comercial validado).
- Integración SUNAT, facturación electrónica o guía SUNAT desde este sistema. Si Odoo ya emite comprobantes SUNAT, es asunto de Odoo, no de ZDRY.
- Pasarela de cobro automático (Culqi / Izipay / Stripe). El cliente paga por transferencia / interbancario y **sube el comprobante**.
- App nativa móvil (el operador de patio usa la web responsive + cámara del dispositivo).
- Multi-empresa / multi-país (un solo tenant ZDRY Perú).
- CRM avanzado ni campaña de marketing.
- WMS de picking de mercadería interior (ZDRY mueve contenedores, no pallets de terceros salvo custodia).

Estas exclusiones no contradicen la documentación técnica del prototipo: el footer del HTML declara SUNAT y pasarela como simuladas. La decisión de producto 1.1 las **retira del alcance** y las sustituye por el flujo humano + Odoo.

### 1.5 Cierre comercial: comprobante, validación humana y Odoo (imprescindible)

El prototipo marca una cotización “Ganada” con un clic. En el negocio real **nadie asigna un contenedor ni mueve patio hasta que un comercial confirma que el dinero está**. El pago suele ser transferencia o interbancario: el cliente ya subió el voucher y el abono **todavía no aparece** en la cuenta. Mientras tanto el patio puede tener que hacer movimientos para extraer la unidad, o el cliente pide transporte. Esos gastos no se improvisan: los evalúa y confirma el comercial.

Este flujo es requisito de arranque (Sprint 0 deja el contrato; Sprint 4 lo implementa). No se pospone a “integraciones al final”.

#### Flujo feliz

```
1. Cliente reserva (unidad en hold 48 h).
2. ANTES de pagar, puede pulsar “Hablar con un comercial”
   para tentar un descuento. Queda un hilo en la bandeja del vendedor asignado.
3. Comercial responde: otorga descuento (sin bajar del piso de lista
   salvo regla más específica) o rechaza. La cotización se actualiza y se recongela.
4. Cliente paga fuera del sistema (transferencia / interbancario / depósito).
5. Cliente sube el comprobante (imagen o PDF) a su reserva.
6. El sistema avisa al comercial asignado (in-app + correo; WhatsApp en S10).
7. Comercial abre la atención:
      a. Revisa el voucher vs. el monto cotizado.
      b. Si es interbancario y aún no acredita: marca “en verificación”
         (la reserva NO se libera; se puede extender el hold).
      c. Si el voucher no cuadra: rechaza con motivo; el cliente puede re-subir.
      d. Si el pago está acreditado: valida.
8. Con el pago validado, el comercial:
      - Confirma la asignación del ISO (la unidad pasa a comprometido).
      - Informa / cotiza movimientos de patio si hay que extraer la unidad
        (regla de posición: contenedores encima). El cliente acepta o retira.
      - Ofrece transporte ZDRY (motor de fletes) como ítem adicional.
      - Programa fecha/ventana de despacho.
9. Recién entonces ZDRY empuja a Odoo: partner, orden de venta, pago y
   líneas (unidad + extras). Almacén ve el despacho programado y lo ejecuta.
```

#### Por qué no es automático

| Hecho operativo | Si el sistema “cierra solo” |
|---|---|
| Interbancario demora horas o 1 día hábil | Se asigna stock sobre dinero que no está |
| Extraer un 40' puede exigir 2–3 movimientos de patio | El costo no se cobra y ZDRY lo absorbe |
| El cliente a veces quiere flete recién al pagar | Se despacha sin transporte ni tarifa |
| El descuento se negocia persona a persona | Un botón de “Ganada” salta al comercial |

El comercial es el **único** que puede pasar `comprobante_subido` → `pago_validado` → `asignacion_confirmada` → `despacho_programado`. El API rechaza esos saltos si los intenta el cliente o un job.

#### Relación con Odoo

ZDRY es el sistema operativo (patio, ISO, reglas, reserva, validación). Odoo es el sistema contable/administrativo. El contrato:

- **ZDRY → Odoo** cuando el comercial valida el pago y confirma asignación: crear/actualizar contacto, orden de venta, registro de pago, líneas de extras (movimientos, flete).
- **Odoo no manda sobre el patio.** Un cambio de factura en Odoo no mueve un contenedor.
- **ZDRY no habla con SUNAT.** Comprobantes fiscales, si existen, salen de Odoo.
- Si Odoo no responde, la operación en ZDRY **sigue**: se encola el sync (`odoo_sync_queue`) y el comercial no queda bloqueado. El despacho físico sí puede exigir sync exitoso o un override de Admin (configurable; default MVP = no bloquear patio).

---

## 2. Identidad visual y sistema de diseño

El plan de interfaces **no rediseña** el prototipo. Se porta el CSS, los componentes y la jerarquía visual. El logo oficial reemplaza el isotipo CSS (caja naranja con líneas) que hoy usa el HTML.

### 2.1 Logo oficial — `LOGO_Z.png`

El archivo `LOGO_Z.png` es la marca del producto. Composición:

- Wordmark **ZDRY** en sans-serif geométrica extra-bold, industrial.
- **Z** blanca; **D** con degradado horizontal blanco → naranja; **R** y **Y** naranja sólido.
- Silueta unificada con borde/bloque navy que une las cuatro letras.
- Tagline en versales, tracking amplio: **VENTA Y ALQUILER DE CONTENEDORES**.
- Pensado para fondo oscuro (negro / navy). En fondos claros se usa sobre pastilla navy o se recorta el wordmark.

**Uso obligatorio en el sistema:**

| Superficie | Cómo se usa |
|---|---|
| Topbar (todas las vistas internas y catálogo) | Wordmark recortado a la izquierda, altura ~28–32 px, en lugar de `.brand .box` + texto “ZDRY” |
| Login / splash | Logo completo (wordmark + tagline) centrado sobre fondo navy `#12203a` |
| Favicon / PWA | Recorte de la **Z** blanca sobre navy, o wordmark compacto |
| PDF de cotización, guía, contrato, informe de trazabilidad | Logo completo en encabezado, fondo blanco con wordmark (el navy del borde alcanza contraste) |
| Correos transaccionales | Logo en cabecera navy |
| Footer interno | Wordmark pequeño + “El supermercado de contenedores” |

No se redibuja el logo en CSS. No se cambia la geometría ni los colores del PNG. El isotipo de caja naranja del prototipo **se retira**.

### 2.2 Tokens extraídos del HTML (fuente de verdad de UI)

Estos valores salen de `:root` en `zdry_prototype_26.html` y se copian 1:1 a un Design Token / CSS variables del frontend de producción. El naranja de marca del logo es más saturado que `--orange` del prototipo; **en UI se mantiene el naranja del HTML** para no romper contraste de botones, chips y estados activos. El naranja del logo se usa solo en el PNG.

| Token | Valor | Uso |
|---|---|---|
| `--navy` | `#12203a` | Topbar, hero, headers de tabla-card, números KPI, botones ghost activos |
| `--navy-2` | `#1c3358` | Gradiente inferior del hero del catálogo |
| `--orange` | `#d9622f` | CTA primario, pill de cotización, subtab activo, links de acción |
| `--orange-dark` | `#b64f22` | Hover de CTA, texto de “Solicitar precio”, notas locked |
| `--bg` | `#f4f5f7` | Fondo de aplicación |
| `--card` | `#ffffff` | Paneles, cards, modales |
| `--line` | `#e2e4ea` | Bordes |
| `--text` | `#1a1d29` | Texto principal |
| `--text-2` | `#5c6370` | Labels, meta |
| `--text-3` | `#8a90a2` | Placeholders, footer |
| `--green` | `#2f9e44` | Éxito, checklist done, 1TRIP |
| `--blue` | `#1971c2` | 20GP/40GP, FK en esquema, badges de venta |
| `--teal` | `#0c8599` | 40HC/45HC, badges de alquiler |
| `--amber` | `#c9720b` | Alertas de cola, ASIS, Open Top |
| `--red` | `#c92a2a` | Error, mora, eliminar |
| `--radius` | `10px` | Cards y paneles (`14px` en modales) |
| `--shadow` | `0 1px 2px rgba(18,32,58,.06), 0 4px 14px rgba(18,32,58,.05)` | Elevación |

Tipografía: stack del prototipo (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`). ISO y códigos en `ui-monospace`. Títulos `font-weight: 700–800`, letter-spacing negativo leve. Labels de formulario en mayúsculas 11 px, tracking 0.03 em.

### 2.3 Componentes de interfaz a portar (no reinventar)

Cada pantalla nueva se arma con estos bloques, ya existentes en el HTML:

- **Topbar** navy 60 px, logo, navtabs, pill naranja de cotización / usuario.
- **Hero** navy→navy-2 solo en catálogo público.
- **Quickfilter** blanco superpuesto al hero (buscador + selects + CTA).
- **Card de unidad** (media 140 px, badge de condición, badge de estado, ISO mono, precio o CTA “Solicitar precio”).
- **Modal PDP** 980 px, galería + thumbs + lightbox con zoom.
- **Modal de cotización** 640 px.
- **Role-row / Subtabs**: inactivo blanco con borde; activo navy (roles) o naranja (subtabs).
- **Panel + table.data**: th uppercase 10.5 px, filas expandibles, chevron.
- **Tiles / stat-row**: número 20–22 px navy, label uppercase.
- **Form-grid / filterbar / pill-check / checklist de 9 fotos**.
- **Gateflow** (botones Gate In / Gate Out).
- **Progress bar** de meta comercial.
- **Badge-scope** (venta azul, alquiler teal, almacenaje gris).
- **Locked-note** naranja (dato que el rol no puede ver o acción bloqueada).
- **Confirm-icon** verde circular.
- **Schema table-card** (solo entorno interno / docs; no es pantalla de usuario final en producción).

Breakpoints a respetar: dash-grid 900 px → 1 col; modal 760 px → 1 col; lightbox 640 px.

### 2.4 Principios de gráficos (ya decididos en el prototipo)

- Una sola serie: un solo tono navy, magnitud por longitud, etiqueta numérica, sin leyenda.
- Varias series: color fijo por identidad + leyenda siempre visible.
- Conteos discretos por semana: **barras**, nunca líneas (una línea inventa tendencia continua).
- Nunca doble eje.

---

## 3. Actores y mapa de permisos (RBAC real)

El prototipo simula cinco roles. En producción el cambio de rol desaparece: cada usuario entra con su cuenta y el servidor filtra datos y acciones.

| Rol | Quién es | Ve costos reales | Configura reglas | Opera patio | Opera comercial |
|---|---|---|---|---|---|
| **Administrador Total** | Dueño / gerencia general | Sí | Sí | Lectura | Lectura + override documentado |
| **Gerente de Ventas** | Jefe comercial | No (salvo margen, no FOB) | Precio, visibilidad, alquiler, fletes | No | KPIs de equipo |
| **Vendedor / Comercial** | Ejecutivo de cuenta | No — solo precio lista y mínimo | Descuento dentro de su piso | No | Cotiza, negocia descuento pre-pago, valida comprobantes, confirma asignación, ofrece flete/movimientos, programa despacho |
| **Compras / Costos** | Importaciones y CxP | Sí (compra y terceros) | Tarifas de proveedores (propuesta) | No | No |
| **Almacén / Operador** | Stackero, vigilante, despachador | No | No | Sí | No |
| **Cliente (cuenta ligera)** | B2B/B2C con reserva | No | No | No | Catálogo, reserva, chat de descuento, sube comprobante, acepta extras |

**Regla de datos:** el costo real (`C_T`, FOB, DAM, prorrateos) nunca viaja al frontend del vendedor ni del operador. El API oculta campos, no solo la UI.

Roles adicionales recomendados para producción (no están en el prototipo, se añaden sin cambiar pantallas existentes):

| Rol extra | Motivo |
|---|---|
| **Vigilante de puerta** | Subconjunto de Almacén: solo confirmar salida física |
| **Auditor / read-only** | Compliance interno sin mutar |
| **Sistema / integración** | Service account para Maps, SMTP y **Odoo** (XML-RPC / JSON-2) |

---

## 4. Arquitectura objetivo (Docker)

### 4.1 Diagrama lógico

```
                         ┌─────────────┐
   Cliente web  ─────────│  Nginx /    │
   (catálogo + ERP)      │  Caddy      │
                         └──────┬──────┘
                    ┌───────────┴───────────┐
                    │                       │
             ┌──────▼──────┐         ┌──────▼──────┐
             │  Frontend   │         │   API       │
             │  (SPA)      │         │  (NestJS)   │
             └─────────────┘         └──────┬──────┘
                                            │
                    ┌───────────────┬───────┼────────┬──────────────┐
                    │               │       │        │              │
             ┌──────▼───┐    ┌──────▼──┐ ┌──▼───┐ ┌──▼────┐  ┌──────▼──────┐
             │ Postgres │    │ Redis   │ │MinIO │ │Worker │  │ Integraciones│
             │ 16       │    │ (locks, │ │(S3)  │ │(colas)│  │ Odoo, Maps,  │
             │          │    │ cache,  │ │fotos │ │mora,  │  │ SMTP         │
             │          │    │ sesión) │ │PDF   │ │reservas│ └─────────────┘
             │          │    │         │ │compr.│ │odoo   │
             └──────────┘    └─────────┘ └──────┘ └───────┘
```

### 4.2 Stack recomendado

Se elige continuidad con el prototipo (lógica ya escrita en JavaScript) y operación simple en Docker.

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend | React + Vite + CSS modules/tokens copiados del HTML | Porta pantallas 1:1; no impone un rediseño de componentes |
| Backend | NestJS (Node 22) + Prisma | La lógica de `zdry_prototype_26.html` se extrae a servicios de dominio sin reescribir algoritmos |
| Base de datos | PostgreSQL 16 | Relacional, JSONB para reglas, constraints, transacciones |
| Caché / locks | Redis 7 | Reserva 48 h, lock de posición de patio, lock de ISO, sesión |
| Archivos | MinIO (dev/prod self-host) con contrato S3 | Fotos 1–9, video 360, fotos de camión, PDFs, **comprobantes de pago** |
| Colas | BullMQ sobre Redis | Expiración de reservas, recálculo de mora, envío de mail, compactación de patio, **aviso a comercial**, **sync Odoo** |
| Reverse proxy | Nginx | TLS, gzip, estáticos, `/api` |
| ERP contable | Odoo 16/17 (externo; no corre dentro del Compose de ZDRY en MVP) | Partner, orden de venta, pago. Connector en `zdry-worker` |
| Observabilidad | OpenTelemetry + Loki/Grafana (fase posterior al MVP) | Auditoría operativa |
| Pruebas | Playwright (portar la suite actual) + Jest/Vitest de dominio | Las 21 pruebas E2E son patrimonio |

**No** se usa un monolito HTML en producción. El HTML actual queda como **referencia visual y oráculo de reglas** durante los sprints 0–4.

### 4.3 Servicios Docker Compose (entorno de desarrollo = entorno de staging)

```yaml
# Composición lógica (nombres de servicio)
zdry-web          # frontend Nginx + estáticos
zdry-api          # NestJS
zdry-worker       # BullMQ
zdry-db           # Postgres 16 + volumen
zdry-redis        # Redis 7
zdry-minio        # S3
zdry-mailhog      # SMTP de desarrollo (hasta integrar SES/SendGrid)
zdry-migrator     # job one-shot de Prisma migrate + seed
# Odoo NO se levanta aquí: URL + API key en .env (staging apunta al Odoo del cliente)
```

Requisitos de operación:

- Un solo comando: `docker compose up --build`.
- Variables en `.env` (nunca en la imagen).
- Healthchecks en API, DB y Redis; el web no arranca hasta que API responde `/health`.
- Seed de demostración **opt-in** (`SEED_DEMO=true`) para no ensuciar un patio real.
- Backups: `pg_dump` diario + versionado de bucket MinIO.
- El stack es el mismo en laptop, staging y producción; cambian solo env, volúmenes y TLS.

### 4.4 Extraer la lógica del prototipo (no reescribirla)

El archivo HTML es ~6.600 líneas de script. El plan de extracción:

| Bloque del HTML | Destino en producción |
|---|---|
| `parseIso6346`, `iso6346CheckDigit` | `domain/iso6346` — tests unitarios idénticos |
| `bestSlotFor`, `columnCompatible`, `nextNivelInColumn` | `domain/yard` — **único** camino para asignar posición |
| `suggestedMonthlyRent`, `rentalRateFor`, `buildPaymentSchedule` | `domain/rentals` |
| `haversineKm`, `estimateRouteDistanceKm`, `trucksNeededFor` | `domain/freight` — interfaz `DistanceProvider` (haversine hoy, Google mañana) |
| `defaultPurchaseExtras`, Incoterm/logística | `domain/purchases` |
| Resolución jerárquica de `PRICING_RULES` / `VISIBILITY_RULES` | `domain/pricing` |
| `authorizeGuia`, `verifyTruck`, `markDispatched` | `domain/dispatch` |
| `paymentEffectiveStatus` | `domain/rentals` — siempre calculado, nunca persistido como verdad |
| Cierre comercial (nuevo, no está en el HTML) | `domain/deal-close` — reserva → hilo de descuento → voucher → validación → extras → asignación → despacho → Odoo |
| Funciones `*Html()` | Componentes React; **no** van al backend |

Criterio: si una función del prototipo **bloquea** una acción, el test de dominio debe fallar si el API la permite.

### 4.5 Estructura del repositorio (Sprint 0)

```
zdry/
  docker-compose.yml
  .env.example
  apps/
    api/          NestJS — dominio, auth, cola Odoo
    web/          Vite + React — tokens del HTML + logo
  packages/
    domain/       (S1+) ISO, patio, pricing, deal-close
  legacy/         prototipo HTML (solo staging)
  proyecto_zdry.md
  LOGO_Z.png
```

Arranque local: `docker compose up --build`. Web en `:5173` (dev) / `:80` (compose). API en `:3000`.

---

## 5. Modelo de datos de producción

El esquema didáctico del prototipo (vista “Esquema BD”) es incompleto a propósito. El modelo real debe cubrir **todas** las entidades que el HTML ya muta.

### 5.1 Entidades núcleo (obligatorias)

| Entidad | Origen en prototipo | Notas de producción |
|---|---|---|
| `users`, `roles`, `permissions` | `ROLES` simulado | Auth JWT + refresh; bcrypt/argon2 |
| `depots` | `DEPOTS` (Callao, Ventanilla, Lurín, Paita) | lat/lng, tarifa diaria TEU |
| `container_types`, `categories` | `TYPES`, `CATEGORIES` | catálogo maestro editable por Admin |
| `containers` | `CONTAINERS` | PK operativa = ISO 6346; UUID interno |
| `container_positions` | lado/ruma/columna/nivel | historial; posición actual es la última abierta |
| `container_history` | `history[]` | append-only |
| `nationalizations` | `nationalization` / DAM | BL, manifiesto, nro DAM, fechas |
| `purchase_invoices` | `PURCHASE_INVOICES` | Incoterm, logística, líneas por unidad (no un monto único prorrateado a ciegas) |
| `purchase_invoice_lines` | `generatePiRows` | precio y tipo por unidad |
| `pending_extra_costs` | `PENDING_EXTRA_COSTS` | cola reglada |
| `cost_invoices` | `INVOICES` | monto, proveedor, estado de pago |
| `invoice_allocations` | prorrateo | equal / teu / cbm / fixed / single |
| `providers` | `PROVIDERS` | no eliminar si está en uso |
| `customers` | `CUSTOMERS` | RUC/DNI, riesgo A–D |
| `quotes` | `QUOTES` | kind = venta \| alquiler; ver máquina de cierre §8.2b |
| `quote_units`, `quote_extra_items` | unidades + servicios/flete | extras de **cierre**: movimiento de patio, transporte |
| `reservations` | reserva 48 h | job de expiración; **se pausa** si hay voucher en verificación o hilo de descuento abierto |
| `deal_threads` | (nuevo) | Chat cliente↔comercial pre-pago para descuento |
| `payment_vouchers` | (nuevo) | Archivo MinIO, monto declarado, banco, fecha, estado |
| `payment_validations` | (nuevo) | Quién validó, cuándo, resultado, nota de interbancario |
| `odoo_sync_queue` | (nuevo) | Payload, intentos, last_error; unique por quote+evento |
| `rentals` | `RENTALS` | tarifa, plazo, firma |
| `rental_payments` | cronograma | mora **calculada**; se puede snapshotear para reportes históricos |
| `dispatches` | `DISPATCHES` | reason = venta \| alquiler \| almacenaje |
| `dispatch_trucks` | camiones del despacho | fotos, precinto, guía, salida |
| `fleet_trucks` | flota propia | constraint único (truck_id, date) activo |
| `pricing_rules`, `visibility_rules`, `rental_rate_rules` | reglas jerárquicas | siempre ≥1 regla global |
| `freight_zones`, `terrain_profiles` | `FREIGHT_ZONES`, `TERRAIN_PROFILES` | |
| `commercial_services`, `depot_services`, `extra_cost_concepts` | catálogos | nunca texto libre en cotización |
| `layout_rules` | `LAYOUT_RULES` | min/max nivel, groupCategoria, groupProveedor |
| `media_assets` | photos/video | URI S3, no base64 |
| `audit_logs` | ausente en prototipo | quién, qué, before/after, IP |
| `sales_team_metrics` | KPIs vendedor | snapshot diario opcional |

### 5.2 Fórmula de costo (se implementa en servidor)

Tal como el prototipo la documenta en la vista de esquema:

```
C_T (con descuentos) = C_compra + G_aduana + G_transp + G_almacen_ing + G_nac
                     + Imp_nac + G_gate + G_mantenimiento
                     + Σ costos adicionales prorrateados
                     + C_estadía_neta + C_posición_neta

C_estadía_neta   = max(0, días_en_patio − días_libres) × tarifa_diaria_TEU × factor_TEU
C_posición_neta  = max(0, movimientos_para_extraer − movimientos_libres) × tarifa_movimiento
movimientos_para_extraer = contenedores apilados encima (recalculado en vivo)
Precio_cliente   = Precio_neto × 1.18   (IGV solo en el punto de venta)
```

`C_T_real` se calcula igual **sin** restar días/movimientos libres, y se muestra en paralelo al Administrador. El vendedor nunca recibe `C_T`.

### 5.3 Constraints que el prototipo “bloquea en JS” y Postgres debe garantizar

- `containers.iso` único.
- Una unidad no puede estar en dos `dispatch_trucks` con estado activo.
- Un `fleet_trucks` no puede tener dos despachos el mismo día (índice único parcial).
- `pricing_rules` / `visibility_rules`: trigger que impide borrar la última fila `scope=global`.
- Posición `(depot_id, lado, ruma, columna, nivel)` única entre unidades con `physically_received` y no despachadas.
- No se elimina `providers` ni `container_types` referenciados.

Los constraints **no reemplazan** las 4 reglas de patio: esas siguen en `domain/yard`. El unique de posición es la red de seguridad.

---

## 6. Mapa de módulos e interfaces a crear

Cada interfaz de producción corresponde a una pantalla ya visible en el HTML. Rutas tentativas; layout idéntico.

### 6.1 Aplicación pública (catálogo)

| Ruta | Pantalla HTML de origen | Contenido |
|---|---|---|
| `/` | `#view-catalog` | Hero, quickfilter, chips de condición, grid de cards, pager |
| `/u/:iso` | Modal PDP | Galería 9 fotos + video 360, specs, precio o “Solicitar precio”, cotizador de flete rápido |
| `/cotizar` | Modal carrito | Unidades seleccionadas, datos de cliente, envío de solicitud |
| `/login` | (nueva) | Fondo navy, logo completo, formulario interno |
| `/mi-cuenta` | (nueva — cliente) | Reservas, cotizaciones, subir comprobante, hablar con comercial |
| `/mi-cuenta/reserva/:id` | (nueva — cliente) | Estado del hold, chat de descuento, upload de voucher, extras pendientes de aceptar |

**Comportamiento a preservar:**

- Solo unidades propias `intake_type=compra` y estado vendible.
- Precio público según `VISIBILITY_RULES`; si no aplica, chip `#fff7ed` “Solicitar precio”.
- Filtros: texto, tipo, condición, depósito, fabricante, año.
- Cotización pública crea `quotes.status=Nueva` asignada a un vendedor (round-robin o territorio).

### 6.2 Aplicación interna (Dashboard)

Topbar: logo + nav (sin pestaña “Esquema BD” en producción; esa vista queda en `/admin/docs` o se elimina). Selector de depósito opcional. Menú según rol. Avatar + logout.

#### Administrador Total

| Subtab HTML | Ruta | Qué se construye |
|---|---|---|
| Inventario y costos | `/admin/inventario` | Tabla expandible por ISO, `C_T` y `C_T_real`, filtros, informe imprimible |
| Analítica de inventario | `/admin/analitica` | SVG/barras: precio promedio, estadía, matriz depósito×tipo o ×condición, serie semanal |
| Ventas y alquileres — Trazabilidad | `/admin/trazabilidad` | Unidades vendidas/alquiladas, bitácora, fotos |
| Personas | `/admin/personas` | Clientes, proveedores, colaboradores (alta/edición, riesgo A–D) |
| Configuración | `/admin/configuracion` | Ver 6.3 |

#### Gerente de Ventas

| Subtab HTML | Ruta |
|---|---|
| Reglas de precio | `/gerente/precios` |
| Configuración (compartida) | `/admin/configuracion` |
| Desempeño del equipo (en el prototipo vive junto a pricing) | `/gerente/equipo` |

#### Vendedor / Comercial

| Subtab HTML | Ruta |
|---|---|
| Inventario disponible | `/ventas/inventario` — **sin** costo real; precio lista y mínimo |
| Bandeja de cotizaciones | `/ventas/bandeja` — badge naranja con count |
| Negociación de descuento (pre-pago) | `/ventas/negociacion` — hilos abiertos por clientes que piden descuento **antes de pagar** |
| Pagos por validar | `/ventas/pagos` — comprobantes subidos; estados: nuevo, en verificación (interbancario), rechazado, validado |
| Seguimiento de cotizaciones | `/ventas/seguimiento` — badge azul |
| Contratos de alquiler | `/ventas/alquileres` — badge teal |

KPI de “Mi desempeño” (tiempo de respuesta, cerradas, perdidas, meta + progress bar) permanece arriba de inventario.

#### Compras / Costos

| Subtab HTML | Ruta |
|---|---|
| Facturas de compra | `/compras/facturas` |
| Costos adicionales | `/compras/extras` — badge ámbar = pendientes |
| Nacionalización (DAM) | `/compras/dam` — badge ámbar = sin DAM |

#### Almacén / Operador

| Subtab HTML | Ruta |
|---|---|
| Recepción e inspección | `/almacen/recepcion` — 3 entradas: compra pendiente, ingreso nuevo, devolución de alquiler |
| Layout de patio y stock | `/almacen/patio` — rumas/columnas/niveles, sugerencia `bestSlotFor` |
| Despachos | `/almacen/despachos` — programados / pendientes / historial |

### 6.3 Configuración centralizada (Admin + Gerente)

Un solo panel, como `configuracionHtml()`:

1. Visibilidad de precios (reglas jerárquicas).
2. Tarifario de fletes (zonas, terrenos, márgenes min/rec/premium, vehículos).
3. Reglas de alquiler (depreciación, márgenes, descuento por plazo, recargo/descuento por riesgo A–D).
4. Proveedores (lectura; alta en Personas).
5. Servicios propios del depósito.
6. Servicios comerciales de cotización (precio fijo, nunca texto libre).
7. Conceptos de costos adicionales.
8. Reglas de columna de patio (min/max nivel, agrupar por condición, agrupar por fabricante).
9. Descuentos operativos (días libres, movimientos libres).
10. Flota de camiones.

Cambio de una regla global es inmediato y queda en `audit_logs`. En un segundo corte: borrador + aprobación (hoy el prototipo no lo tiene; se documenta como deuda, no se bloquea el MVP).

### 6.4 Documentos generados (mismas plantillas visuales)

- PDF de cotización (logo + tabla de unidades + extras + IGV).
- Contrato de alquiler para firma.
- Informe general del contenedor (`containerFullReportHtml`) — imprimible, clase `print-report-target`.
- Guía de remisión **interna** de patio (no es comprobante SUNAT; la factura fiscal, si aplica, la emite Odoo).
- Correo de aviso al comercial: “hay un comprobante por validar” / “el cliente pide descuento”.
- Recibo operativo de reserva (no fiscal) para el cliente.

---

## 7. Catálogo de casos de uso

Convención: **UC-XX-NN**. Actor, precondición, flujo feliz, alternativas y regla de bloqueo. Estos casos son el backlog aceptable de QA: un sprint no está “hecho” si sus UC no tienen prueba automatizada.

### 7.1 Fundación y acceso — UC-00

| ID | Nombre | Actor | Descripción |
|---|---|---|---|
| UC-00-01 | Iniciar sesión | Cualquier usuario interno | Email + password; JWT; redirección al dashboard de su rol |
| UC-00-02 | Recuperar contraseña | Usuario interno | Mail de reset; token de un solo uso |
| UC-00-03 | Ver solo lo de su rol | Sistema | Intento de URL o API ajena → 403; campos de costo omitidos |
| UC-00-04 | Cerrar sesión | Usuario | Invalida refresh token |
| UC-00-05 | Mantener catálogos maestros | Admin | Alta/edición de tipo, categoría, depósito; no borrar si hay unidades |
| UC-00-06 | Impersonación de demo | Admin (solo staging) | Equivale al role-row del prototipo; **deshabilitado en producción** |

### 7.2 Catálogo público — UC-10

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-10-01 | Buscar unidades | Visitante | Filtros del hero; grid + pager; solo stock vendible propio |
| UC-10-02 | Ver ficha (PDP) | Visitante | Galería, specs, lightbox zoom |
| UC-10-03 | Ver precio público | Visitante | Si la regla de visibilidad aplica, muestra precio; si no, CTA “Solicitar precio” |
| UC-10-04 | Estimar flete rápido | Visitante | Zona o texto/Maps; no compromete precio de venta |
| UC-10-05 | Armar carrito y solicitar cotización | Visitante | Datos de contacto; crea quote `Nueva`; reserva **no** automática |
| UC-10-06 | Solicitar alquiler desde catálogo | Visitante | Misma bandeja; `kind=alquiler`; no se vuelve a pedir datos del cliente |
| UC-10-07 | Crear cuenta ligera para reservar | Cliente | Email + teléfono; necesaria para chat, voucher y aceptar extras |

### 7.3 Compras e inventario — UC-20

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-20-01 | Registrar factura de compra | Compras | Cabecera (nro, proveedor, Incoterm, logística, depósito destino) + líneas por unidad (tipo, precio, ISO) |
| UC-20-02 | Validar ISO 6346 en vivo | Compras | 3 letras + U + 6 dígitos + check digit; sugiere corrección |
| UC-20-03 | Declarar excepción de ISO | Compras | Motivo obligatorio; queda en historial; no bloquea eterno |
| UC-20-04 | Rechazar ISO duplicado | Sistema | Bloquea registro |
| UC-20-05 | Generar extras por logística | Sistema | Al elegir “recojo + flete + gate out” marca transporte y gate out como pendientes; agente de aduana **siempre** obligatorio y no desmarcable |
| UC-20-06 | Registrar DAM | Compras | BL + manifiesto + nro DAM con formato válido |
| UC-20-07 | Listar unidades sin nacionalizar | Compras | Badge ámbar |
| UC-20-08 | Ver estado agregado de extras | Compras | incluido / no aplica / pendiente de registrar / registrado sin pagar / pagado |

### 7.4 Recepción y patio — UC-30

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-30-01 | Recibir unidad de una compra | Almacén | Checklist 9 fotos + video 360; marca `physically_received` |
| UC-30-02 | Ingreso nuevo sin factura previa | Almacén | `intake_type=pendiente_factura`; Compras cierra el círculo después |
| UC-30-03 | Ingreso por custodia de cliente | Almacén | `almacenaje_cliente`; dueño = customer; descuento de almacenaje; no pasa por compra |
| UC-30-04 | Sugerir mejor posición | Sistema | `bestSlotFor`: no mezcla tamaños; no mezcla nuevo/usado si está activo; gravedad; columna nueva solo si la anterior está llena |
| UC-30-05 | Mover unidad manualmente | Almacén | Pasa por el mismo validador; violación → mensaje explícito, no se guarda |
| UC-30-06 | Compactar patio | Almacén / job | Reubica respetando reglas; usado también post-seed |
| UC-30-07 | Unidad comprometida ocupa patio | Sistema | Vendida/alquilada sigue en slot hasta `markDispatched` |
| UC-30-08 | Gate In / Gate Out | Almacén | Cobra tarifa de servicio propio al marcarse |
| UC-30-09 | Recibir devolución de alquiler | Almacén | Checklist; si hay golpe, genera cargo de reparación; reubica |

### 7.5 Comercial (venta) — UC-40

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-40-01 | Ver inventario vendible | Vendedor | Precio lista y mínimo; “en web sí/no”; sin FOB |
| UC-40-02 | Generar cotización interna | Vendedor | Cliente + unidades |
| UC-40-03 | Responder bandeja | Vendedor | Pasa Nueva → Cotizada; no puede enviar venta bajo precio de lista salvo regla más específica |
| UC-40-04 | Agregar servicio comercial | Vendedor | Solo catálogo de precio fijo |
| UC-40-05 | Agregar flete a la cotización | Vendedor | Bloquea si margen &lt; mínimo configurado |
| UC-40-06 | Reservar unidad 48 h | Cliente / Vendedor | Hold con lock ISO; el reloj **se pausa** si hay hilo de descuento abierto o voucher en verificación |
| UC-40-07 | Confirmar asignación (reemplaza “Marcar Ganada” del prototipo) | Comercial | Solo después de `pago_validado`. Unidad → comprometido. Dispara cola Odoo. |
| UC-40-08 | Marcar Perdida | Vendedor | Motivo obligatorio; entra a analítica; libera hold |
| UC-40-09 | Generar PDF de cotización | Vendedor | Logo + IGV 18 % |
| UC-40-10 | Ver KPIs propios | Vendedor | Tiempo de respuesta, meta, progress bar |

### 7.5b Cierre de pago, descuento pre-pago y extras — UC-45 (núcleo de negocio)

Este bloque no existe en el prototipo. Es el que arranca el desarrollo comercial.

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-45-01 | Hablar con comercial antes de pagar | Cliente | Desde la reserva: abre `deal_thread`; avisa al vendedor asignado; el hold de 48 h se pausa mientras el hilo está abierto |
| UC-45-02 | Negociar / otorgar descuento | Comercial | Puede bajar precio hasta el **mínimo de lista** (regla 4). Debajo del mínimo → 422 salvo override de Gerente. Recongela la cotización y notifica al cliente |
| UC-45-03 | Rechazar descuento y devolver a pago | Comercial | Cierra el hilo; el cliente ve el precio vigente; el reloj de reserva se reanuda |
| UC-45-04 | Subir comprobante de pago | Cliente | Imagen/PDF a MinIO; declara banco, nro operación, fecha, monto. Pasa a `comprobante_subido`. Aviso inmediato al comercial |
| UC-45-05 | Re-subir comprobante | Cliente | Solo si el anterior fue `rechazado`; el historial de vouchers se conserva |
| UC-45-06 | Marcar “en verificación” (interbancario) | Comercial | El dinero aún no acredita; la unidad **sigue reservada**; nota obligatoria (“esperando CCI 24–48 h”) |
| UC-45-07 | Validar pago | Comercial | Confirma que el abono cuadra con la cotización congelada. Único paso que habilita asignación |
| UC-45-08 | Rechazar pago | Comercial | Motivo obligatorio (monto distinto, voucher ilegible, cuenta errónea). Cliente puede re-subir |
| UC-45-09 | Evaluar movimientos de patio | Comercial | El sistema calcula `movimientos_para_extraer` (unidades encima). El comercial informa el costo de movimiento y lo agrega como extra, o indica que ZDRY lo asume (override Admin) |
| UC-45-10 | Ofrecer transporte | Comercial | Cotiza flete (UC-70) sobre la misma reserva; el cliente acepta o retira. Margen mínimo de flete sigue aplicando |
| UC-45-11 | Cliente acepta / rechaza extras | Cliente | Sin aceptar movimientos necesarios, no se programa despacho (salvo retiro en patio por cuenta del cliente) |
| UC-45-12 | Programar despacho desde comercial | Comercial | Fecha/ventana + depósito. Crea `DISPATCHES` en “Pendiente de programar” o “Programado”. Almacén ejecuta UC-60 |
| UC-45-13 | Empujar cierre a Odoo | Sistema | Tras UC-45-07 + UC-40-07: encola partner + sale.order + pago + líneas. Reintentos. No bloquea al comercial si Odoo cae |
| UC-45-14 | Ver bandeja de pagos por validar | Comercial | Filtro: nuevos, en verificación, rechazados. SLA de primera respuesta (KPI) |

**Regla dura:** no hay `asignacion_confirmada` ni `despacho_programado` sin `pago_validado`. No hay sync Odoo de venta sin asignación confirmada.

### 7.6 Alquileres — UC-50

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-50-01 | Cotizar alquiler | Vendedor | Misma bandeja que venta; se negocia tarifa mensual + plazo |
| UC-50-02 | Calcular tarifa sugerida | Sistema | Costo × depreciación × margen × descuento por plazo × factor riesgo A–D |
| UC-50-03 | Firmar contrato | Vendedor + cliente | `signRentalContract`; cronograma con primera cuota adelantada |
| UC-50-04 | Ver mora en vivo | Vendedor / Gerente | `paymentEffectiveStatus` vs hoy; no hay campo “atrasado” editable |
| UC-50-05 | Registrar pago de cuota | Cliente sube voucher; Comercial valida (mismo motor UC-45) | No hay “marcar pagado” a ciegas; misma cola de comprobantes |
| UC-50-06 | Agregar servicio a mitad de contrato | Vendedor | Una vez **o** financiado con interés `RENTAL_PRORATE_INTEREST_PCT` en cuotas restantes |
| UC-50-07 | Solicitar devolución | Cliente vía vendedor | Crea flujo de recepción UC-30-09 y despacho de retiro si aplica |
| UC-50-08 | Cerrar contrato | Sistema | Última cuota + unidad recepcionada + cargos de reparación saldados |

### 7.7 Despachos — UC-60

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-60-01 | Programar despacho de venta | Comercial lo inicia (UC-45-12); Almacén ejecuta | Motivo `venta`. No se programa si el pago no está validado |
| UC-60-02 | Programar despacho de alquiler / almacenaje | Almacén | Mismo motor |
| UC-60-03 | Despacho parcial (varios camiones/días) | Almacén | Cada camión independiente |
| UC-60-04 | Asignar flota propia | Almacén | Bloquea doble asignación el mismo día |
| UC-60-05 | Verificar camión | Almacén | 5 fotos + precinto + quién corrobora |
| UC-60-06 | Autorizar guía | Almacén | **Bloquea si alguna unidad no está nacionalizada** |
| UC-60-07 | Marcar salida física | Vigilante / Almacén | Exige guía autorizada + nombre de vigilante; libera patio; cierra estado comercial |
| UC-60-08 | Impedir unidad en dos despachos activos | Sistema | Constraint + API |

### 7.8 Fletes — UC-70

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-70-01 | Cotizar origen→destino | Vendedor / catálogo | Distancia (provider) × terreno × vehículo × camiones |
| UC-70-02 | Detectar terreno | Sistema | Terreno del extremo que **no** es depósito ZDRY |
| UC-70-03 | Calcular camiones | Sistema | 1×40'/45' o 2×20' por camión |
| UC-70-04 | Sugerir 3 márgenes | Sistema | mínimo / recomendado / premium |
| UC-70-05 | Recogida en cliente | Vendedor | Terreno relevante = origen del cliente |
| UC-70-06 | Administrar zonas y perfiles | Gerente / Admin | Tarifario en Configuración |
| UC-70-07 | Fallback si Maps falla | Sistema | Haversine + `roadFactor` del prototipo; se etiqueta “estimado aproximado” |

### 7.9 Costos de terceros — UC-80

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-80-01 | Completar pendiente de cola | Compras | Proveedor sugerido + monto cuando llega la factura real (días/semanas después) |
| UC-80-02 | Registrar costo libre | Compras | Concepto del catálogo (reparación, inspección extra, etc.) |
| UC-80-03 | Prorratear | Compras | equal / TEU / CBM / fijo por unidad / 100 % a una |
| UC-80-04 | Marcar pagado / no pagado | Compras | Fecha + nro factura del proveedor |
| UC-80-05 | Filtrar CxP por factura de origen | Compras | |

### 7.10 Administración, reportes — UC-90

| ID | Nombre | Actor | Flujo / reglas |
|---|---|---|---|
| UC-90-01 | CRUD de personas | Admin | Clientes, proveedores, colaboradores |
| UC-90-02 | No eliminar última regla global | Sistema | UC de Configuración |
| UC-90-03 | No eliminar proveedor/tipo en uso | Sistema | |
| UC-90-04 | Analítica de inventario | Admin | Precio promedio, estadía, matriz, evolución semanal |
| UC-90-05 | Informe de trazabilidad por ISO | Admin / Vendedor (su cartera) | Imprimible con fotos |
| UC-90-06 | Desempeño de equipo | Gerente | Respuesta, cerradas/perdidas, meta |
| UC-90-07 | Activar agrupación por fabricante en patio | Admin | Flag `groupProveedor`; revalida movimientos futuros, no reescribe el pasado sin job de compactación |
| UC-90-08 | Alta de camión de flota | Admin | |

---

## 8. Conflictos, condiciones de carrera y decisiones

Estos son los puntos donde el prototipo **no puede** comportarse bien (un solo hilo JS) y donde un sistema real se rompe si no se diseña el conflicto.

### 8.1 Matriz de conflictos

| ID | Conflicto | Actores | Qué pasa si no se resuelve | Resolución de diseño |
|---|---|---|---|---|
| C-01 | Dos vendedores cotizan / reservan el mismo ISO | Vendedor A y B | Doble venta | Reserva exclusiva 48 h con lock Redis `lock:iso:{iso}`; segunda reserva → 409 |
| C-02 | Reserva vs despacho vs movimiento de patio | Ventas + Almacén | Se despacha lo reservado a otro, o se mueve lo ya cargado | Estado de unidad es máquina de estados (ver 8.2); transiciones transaccionales |
| C-03 | Dos operadores piden `bestSlotFor` a la vez | Almacén | Dos contenedores en el mismo slot | `SELECT … FOR UPDATE` sobre columnas del depósito + lock Redis `lock:yard:{depotId}` |
| C-04 | Asignar el mismo camión el mismo día | Almacén | Doble ruta imposible | Unique parcial SQL + chequeo de API |
| C-05 | Unidad en dos despachos activos | Almacén | Guía duplicada | Unique + bloqueo UC-60-08 |
| C-06 | Autorizar guía sin DAM | Compras atrasada + Almacén apurado | Riesgo aduanero/legal | Hard block (regla 3); UI muestra exactamente qué DAM falta |
| C-07 | Precio de lista baja mientras hay cotización abierta | Gerente + Vendedor | Cotización queda bajo lista o sobreprecio | La cotización **congela** precios al pasar a Cotizada; aviso si la regla global cambió |
| C-08 | Cambio de regla de visibilidad | Gerente | Catálogo muestra/oculta precio de golpe | Audit log; opcional “publicar mañana”; MVP = inmediato (como el prototipo) |
| C-09 | Extra de tercero llega **después** de vender | Compras | `C_T` del vendido cambia; margen histórico se distorsiona | El extra se imputa igual (trazabilidad); `C_T` de unidades ya vendidas queda **snapshot** al momento de **asignación confirmada**; el extra posterior va a “ajuste de costo” visible solo a Admin |
| C-10 | Mora de alquiler vs “marcar a mano” | Vendedor | Estado mentiroso | Mora siempre calculada; el pago es el único input |
| C-11 | Devolución de alquiler vs unidad aún comprometida en patio | Almacén | Hueco o doble ocupación | Devolución crea recepción; no reusa el slot viejo si ya se liberó al despachar |
| C-12 | “Vendido” comercial vs aún en patio | Ventas vs Almacén | El prototipo marca Vendido al ganar; el patio sigue ocupado | Estados separados: `commercial_status` (disponible, reservado, comprometido_venta, vendido, alquilado, custodia) y `physical_status` (en_transito_ingreso, en_patio, en_despacho, fuera). El catálogo usa ambos |
| C-13 | Compra con ISO excepcional vs aduana real | Compras | Unidad no nacionalizable | Excepción ISO no exime DAM; se documenta |
| C-14 | Ingreso `pendiente_factura` que nunca se factura | Almacén + Compras | Stock sin costo | Cola visible en Compras; Admin no puede “vender a pérdida ciega”: se exige factura o costo estimado autorizado |
| C-15 | Custodia de cliente vs venta accidental | Vendedor | Vender lo que no es de ZDRY | Catálogo y inventario de vendedor **excluyen** `almacenaje_cliente` |
| C-16 | Flete Maps vs haversine discrepantes | Comercial | Cliente recibe un precio y luego otro | Cotización guarda `distance_source`, km y snapshot del cálculo; no se recalcula al reabrir salvo acción explícita |
| C-17 | Dos depósitos, misma ruma/columna/nivel | Almacén | Confusión de layout | Posición siempre namespaced por `depot_id` |
| C-18 | Video 360 pesado + 9 fotos | Almacén en campo | Timeout, estado a medias | Upload directo a MinIO (presigned URL); la recepción no se cierra hasta media mínima (regla de negocio: 9 fotos obligatorias, video opcional en MVP si la red es mala — **decisión a confirmar**; por defecto el prototipo exige el checklist de fotos) |
| C-19 | Edición de flota / proveedores en uso | Admin | Referencias rotas | Soft-delete; bloqueo si hay despacho/factura abierta |
| C-20 | Reloj de mora vs TZ Perú | Sistema | Cuotas “atrasadas” a medianoche UTC | `America/Lima` en API, DB (`timestamptz`) y worker |
| C-21 | IGV 18 % y redondeo | Comercial | PDF ZDRY vs factura Odoo descuadran | Redondeo a 2 decimales; política documentada (half-up); el monto empujado a Odoo es el congelado en la cotización |
| C-22 | Seed de demo en producción | Ops | Datos ficticios en patio real | `SEED_DEMO` default false; imágenes de demo no van al bucket prod |
| C-23 | Configuración mal editada (regla global de margen 0) | Gerente | Todo el catálogo regalado | Confirmación modal + audit; no hay staging de reglas en MVP (deuda explícita) |
| C-24 | Cliente riesgo D firma 24 meses | Comercial | Incobrable | Recargo automático; tope de plazo configurable; no hay scoring bureau en MVP |
| C-25 | Comprobante subido pero transferencia interbancaria no acredita | Cliente + Comercial | Asignar ISO sobre dinero inexistente | Estado `en_verificacion`; **prohibido** validar/asignar hasta que el comercial marque acreditado. Hold no expira en este estado |
| C-26 | Cliente pide descuento y no paga, ocupando el ISO | Cliente | Stock bloqueado “negociando” | Hilo abierto pausa el reloj; SLA: si el comercial cierra o pasan N horas (default 24 h de hilo inactivo) el hold se reanuda y puede expirar |
| C-27 | Descuento bajo piso de lista | Comercial | Venta a pérdida | Regla 4 en servidor; override solo Gerente, auditado |
| C-28 | Movimientos de patio no cobrados al extraer | Comercial + Almacén | ZDRY absorbe stacker | UC-45-09 obligatorio antes de programar despacho si `movimientos_para_extraer > movimientos_libres` |
| C-29 | Flete ofrecido tarde, despacho ya programado sin transporte | Comercial | Cliente espera camión que no existe | Oferta de transporte es paso explícito del cierre; si el cliente retira, el despacho es “retiro en patio” |
| C-30 | Validar pago y no confirmar asignación | Comercial | Odoo no recibe orden; patio no se entera | UI de cierre es un wizard: validar → extras → asignar → programar. No se puede saltar |
| C-31 | Odoo caído en el momento del cierre | Integración | Comercial bloqueado o doble facturación | Cola con idempotencia (`quote_id` + evento). Cierre ZDRY no espera a Odoo. Reintento worker. Alerta a Admin si >3 fallos |
| C-32 | Doble voucher / doble validación | Cliente + dos comerciales | Dos asignaciones | Un solo `payment_validations` aprobado por quote; lock `lock:quote:{id}` |
| C-33 | Reserva expira mientras el voucher está en revisión | Worker vs Comercial | Se libera el ISO y se vende a otro | Worker **no** expira si `status ∈ {en_negociacion, comprobante_subido, en_verificacion}` |

### 8.2 Máquina de estados de un contenedor (producción)

```
                 [compra registrada]
                         │
                         ▼
              pendiente_recepcion
                         │  UC-30-01
                         ▼
                    en_patio  ◄────────────── devolución alquiler (UC-30-09)
                    /   |   \
                   /    |    \
          reservado  custodia  disponible
               │                 │
               │    (hold; aún NO vendido)
               │                 │
               └─ pago_validado + asignación ──► comprometido ──► en_despacho ──► fuera
```

Transiciones ilegales (API 409): `fuera` → vender; `custodia` → venta; `en_despacho` → nueva reserva; `comprometido` → otra cotización ganada; `reservado` → `comprometido` **sin** `pago_validado`.

### 8.2b Máquina de estados del cierre comercial (quote / reserva)

```
Nueva → Cotizada → Reservada ─┬─ En negociación (descuento pre-pago)
                              ├─ Comprobante subido
                              │         │
                              │         ├─ En verificación (interbancario)
                              │         ├─ Rechazado → (re-subir) → Comprobante subido
                              │         └─ Pago validado
                              │                    │
                              │                    ├─ extras (movimientos / flete) aceptados
                              │                    ├─ Asignación confirmada  →  sync Odoo
                              │                    └─ Despacho programado
                              ├─ Perdida / Expirada (libera ISO)
                              └─ (reloj 48 h corre solo si no hay hilo ni voucher pendiente)
```

### 8.3 Las 17 reglas críticas (deben vivir en API + tests)

Se copian de la documentación técnica. Cada una es un test de dominio **y** un test E2E.

| # | Regla | Módulo | HTTP / efecto |
|---|---|---|---|
| 1 | ISO 6346 con dígito válido | Compras | 422 salvo excepción |
| 2 | ISO duplicado | Compras / Almacén | 409 |
| 3 | DAM completa | Despachos | 409 al autorizar guía |
| 4 | Precio venta ≥ lista | Comercial | 422 |
| 5 | Margen mínimo de flete | Fletes | 422 al agregar ítem |
| 6 | Mismo tamaño en columna | Patio | 409 |
| 7 | Mismo nuevo/usado (si activo) | Patio | 409 |
| 8 | Apilamiento sin huecos | Patio | 409 |
| 9 | Columna siguiente solo si anterior llena | Patio | 409 |
| 10 | Camión sin doble asignación el día | Despachos | 409 |
| 11 | Unidad no en dos despachos activos | Despachos | 409 |
| 12 | Checklist de camión completo | Despachos | 422 |
| 13 | Guía antes de salida física | Despachos | 409 |
| 14 | Reserva 48 h auto-expira **salvo** negociación o voucher pendiente | Comercial | worker (C-33) |
| 15 | Mora recalculada, no persistida | Alquileres | getter |
| 16 | Siempre una regla global de precio/visibilidad | Config | 409 al borrar |
| 18 | No asignar ni despachar sin pago validado por comercial | Cierre | 409 |
| 19 | Descuento pre-pago no baja del piso de lista | Cierre | 422 (override Gerente) |
| 20 | Movimientos de extracción informados antes de programar despacho | Cierre / Patio | 422 si hay unidades encima y no hay extra ni waiver |

---

## 9. Requisitos y criterios de aceptación

### 9.1 Requisitos funcionales (RF) — trazados a módulos

| ID | Requisito | Módulo | UC | Sprint |
|---|---|---|---|---|
| RF-01 | Autenticación real y RBAC en servidor | Auth | UC-00 | 0–1 |
| RF-02 | Persistencia de todas las entidades del §5 | Datos | — | 0–1 |
| RF-03 | Catálogo público filtrable con reglas de visibilidad | Catálogo | UC-10 | 4 |
| RF-04 | Validación ISO 6346 real | Compras | UC-20-02 | 2 |
| RF-05 | Factura de compra con líneas heterogéneas e Incoterm | Compras | UC-20-01 | 2 |
| RF-06 | Cola de extras reglada (agente de aduana inamovible) | Compras | UC-20-05 | 2, 8 |
| RF-07 | DAM obligatoria para guía | Compras/Despacho | UC-20-06, UC-60-06 | 2, 6 |
| RF-08 | Recepción unificada + 9 fotos | Almacén | UC-30 | 3 |
| RF-09 | Motor de patio con 4 reglas | Almacén | UC-30-04 | 3 |
| RF-10 | Custodia de terceros | Almacén | UC-30-03 | 3 |
| RF-11 | Ciclo de cotización venta/alquiler idéntico | Comercial | UC-40, UC-50 | 4–5 |
| RF-12 | Precio jerárquico y piso de lista | Comercial | UC-40-03, UC-45-02 | 4 |
| RF-13 | Servicios comerciales de catálogo | Comercial | UC-40-04 | 4 |
| RF-14 | PDF de cotización con logo | Comercial | UC-40-09 | 4 |
| RF-15 | Reserva 48 h con expiración (pausada en negociación/voucher) | Comercial | UC-40-06, C-33 | 4 |
| RF-16 | Tarifa de alquiler (base, plazo, riesgo) | Alquileres | UC-50-02 | 5 |
| RF-17 | Cronograma y mora en vivo | Alquileres | UC-50-04 | 5 |
| RF-18 | Servicio a mitad de contrato, una vez o financiado | Alquileres | UC-50-06 | 5 |
| RF-19 | Motor único de despacho + parciales | Despachos | UC-60 | 6 |
| RF-20 | Verificación de camión y guía | Despachos | UC-60-05/06 | 6 |
| RF-21 | Motor de fletes intercambiable (haversine → Maps) | Fletes | UC-70 | 7 |
| RF-22 | Margen mínimo de flete bloqueante | Fletes | UC-70 | 7 |
| RF-23 | Cinco métodos de prorrateo y CxP a terceros | Costos | UC-80 | 8 |
| RF-24 | Configuración centralizada | Admin | UC-90 | 1, 9 |
| RF-25 | Analítica + trazabilidad imprimible | Reportes | UC-90-04/05 | 9 |
| RF-26 | Almacenamiento S3 de media | Infra | — | 0, 3 |
| RF-27 | Multiusuario con locks de patio e ISO | Infra | C-01, C-03 | 3, 4 |
| RF-28 | IGV 18 % solo en punto de venta | Comercial | C-21 | 4 |
| RF-29 | Identidad visual = HTML + `LOGO_Z.png` | UI | §2 | 0 |
| RF-30 | Docker Compose reproducible | Infra | §4 | 0 |
| RF-31 | Chat de descuento pre-pago con comercial | Cierre | UC-45-01–03 | 4 |
| RF-32 | Upload de comprobante y aviso al comercial | Cierre | UC-45-04–08 | 4 |
| RF-33 | Validación humana de pago (incluye interbancario) | Cierre | UC-45-06–07 | 4 |
| RF-34 | Extras de cierre: movimientos de patio + oferta de flete | Cierre | UC-45-09–11 | 4, 7 |
| RF-35 | Programar despacho solo con pago validado y asignación | Cierre | UC-45-12, UC-40-07 | 4, 6 |
| RF-36 | Integración Odoo post-validación (cola idempotente) | Odoo | UC-45-13 | 4 stub, 10 real |

### 9.2 Requisitos no funcionales (RNF)

| ID | Requisito | Meta MVP |
|---|---|---|
| RNF-01 | El operador de patio completa una recepción en 3G | Upload presigned; UI no se bloquea |
| RNF-02 | Catálogo p95 &lt; 400 ms (lista de 2.000 unidades) | Paginación server-side; el prototipo re-renderiza todo — esto **sí** se cambia |
| RNF-03 | API stateless; sesión en Redis | Horizontal scaling del API |
| RNF-04 | TLS en staging y prod | Nginx |
| RNF-05 | Secretos fuera de la imagen | `.env` / Docker secrets |
| RNF-06 | Backup diario de Postgres + MinIO | Restore ensayado una vez por sprint de cierre |
| RNF-07 | Audit log de mutaciones de reglas, precios, DAM, guía | 1 año de retención |
| RNF-08 | Suite E2E verde en CI antes de merge a `main` | Portar smoke de 5 roles + reglas 1–17 |
| RNF-09 | Accesibilidad básica | Contraste navy/naranja ya cumple; focus visible en subtabs y modales |
| RNF-10 | i18n | Español Perú (`es-PE`) únicamente en MVP; montos USD como el prototipo (confirmar con negocio si hay PEN) |

**Decisión abierta de negocio (no técnica):** el prototipo cotiza en USD. Confirmar antes del sprint 4 si el precio de lista es USD, PEN o dual. El plan asume USD + IGV 18 % como el HTML.

### 9.3 Definición de “Hecho” por historia

1. UI pixel-close al HTML (tokens, subtabs, tablas, badges).
2. Logo correcto en topbar y en PDF.
3. Regla de negocio ejecutada en servidor (no solo ocultar botón).
4. Test de dominio de la regla + E2E del flujo.
5. Roles verificados (un vendedor no obtiene `C_T` ni con curl).
6. Sin persistir mora ni posiciones “a mano” saltándose `bestSlotFor`.
7. Sin asignar producto ni programar despacho si el comercial no validó el pago.
8. El descuento pre-pago queda en el hilo y en el audit; el precio congelado es el que viaja a Odoo.

---

## 10. Plan de sprints

Calendario de referencia: **sprints de 2 semanas**, equipo sugerido 1 tech lead, 2 fullstack, 1 QA (puede ser el mismo lead al inicio). 12 sprints ≈ **6 meses** hasta un go-live interno (patio + comercial). La integración **Odoo** se stubbea en S4 y se conecta en S10. **No hay sprint SUNAT ni pasarela.**

Dependencias (igual que las fases del documento técnico): Fundamentos → Compras → Patio → Comercial → Despachos; Fletes es transversal desde Comercial; Costos de terceros se alimentan de Compras y se cierran en paralelo.

### Sprint 0 — Cimientos (infra + diseño)

**Objetivo:** un `docker compose up` que muestra login + shell de dashboard con el look del HTML y el logo real.

- Repos, CI (lint, test, build images), Compose, Postgres, Redis, MinIO, Mailhog.
- Design tokens + layout: topbar, subtabs, panels, tables, botones, cards.
- `LOGO_Z.png` en topbar, login y favicon.
- Healthchecks, migraciones vacías, usuario seed Admin.
- Decisión de moneda (USD/PEN) documentada.
- Contrato de interfaces: `OdooClient` (noop en dev) y `DealClose` (estados del §8.2b) aunque las pantallas vengan en S4.

**Entrega:** screenshot del login y del dashboard vacío indistinguibles en paleta del prototipo; `GET /health` verde en Docker.  
**UC:** UC-00-01 (mínimo). **RF:** RF-01 (parcial), RF-29, RF-30.

### Sprint 1 — Identidad, maestros y RBAC

**Objetivo:** cinco roles reales; catálogos `TYPES`, `CATEGORIES`, `DEPOTS`; Personas (esqueleto).

- Módulo users/roles/permissions; 403 de verdad.
- CRUD depósitos, tipos, categorías, colaboradores.
- Máscara de campos: vendedor nunca recibe costos.
- Audit log base.
- Configuración vacía con anclas de las 10 secciones del §6.3 (stubs).

**Entrega:** cambiar de usuario (no de rol-click) y ver menús distintos.  
**UC:** UC-00-01 a UC-00-05, UC-90-01 (parcial). **Conflictos:** C-22.

### Sprint 2 — Compras, ISO y DAM

**Objetivo:** una factura de compra crea unidades reales en BD.

- Validador ISO 6346 extraído 1:1 del HTML + tests.
- Factura + líneas heterogéneas.
- Árbol Incoterm/logística → `PENDING_EXTRA_COSTS`; agente de aduana inamovible.
- Pantalla DAM; unidades importadas `requiresNationalization`.
- UI: subtabs de Compras idénticos, badges ámbar.

**Entrega:** registrar el caso de uso 1 de la Fase 1 (3×40' chinas, recojo con flete y gate out) y ver la cola de extras.  
**UC:** UC-20-*. **Reglas:** 1, 2. **RF:** RF-04 a RF-07 (DAM se usa en sprint 6).

### Sprint 3 — Recepción y patio

**Objetivo:** cada unidad tiene coordenadas físicas válidas.

- Hub de recepción (3 entradas) + checklist 9 fotos a MinIO.
- Portar `bestSlotFor` y las 4 reglas; **único** writer de posición.
- Layout visual de rumas/columnas/niveles (la pantalla más fiel al HTML).
- Locks Redis + `FOR UPDATE` (C-03).
- Custodia de cliente.
- Unidad comprometida no libera slot.
- Job de compactación.

**Entrega:** el stackero recibe y el sistema sugiere slot; un movimiento ilegal muestra el mismo tipo de mensaje que el prototipo.  
**UC:** UC-30-*. **Reglas:** 6–9. **Conflictos:** C-03, C-17, C-18.

### Sprint 4 — Catálogo, comercial y cierre por comprobante

**Objetivo:** el cliente reserva, puede pedir descuento a un comercial **antes de pagar**, sube el voucher, el comercial valida (incluido interbancario), confirma asignación, informa movimientos/transporte y programa el despacho. “Marcar Ganada” del prototipo **no se porta**.

- Catálogo `/` con hero, filtros, cards, PDP, lightbox.
- Cuenta ligera del cliente (`/mi-cuenta`).
- Visibilidad jerárquica de precio.
- Bandeja, seguimiento, inventario de vendedor (sin `C_T`).
- Piso de precio de lista; servicios de catálogo.
- Reserva 48 h + worker de expiración con **pausa** por hilo/voucher (C-33).
- UC-45 completo: chat descuento, upload comprobante, bandeja de pagos, en verificación, validar/rechazar, extras de movimiento, oferta de flete (stub de distancia si S7 no está), wizard de asignación + programar despacho.
- `OdooClient` noop que encola el payload (se ve en `/admin` como “pendiente de sync”).
- PDF con logo e IGV.
- Congelar precios al cotizar y al otorgar descuento (C-07, C-27).
- Estados `commercial_status` vs `physical_status` (C-12, C-15).

**Entrega:** demo de negocio: reservar → pedir descuento → subir voucher interbancario → comercial marca “en verificación” → valida → agrega movimiento de patio → ofrece flete → confirma ISO → programa despacho. Sin eso, el sprint no está hecho.  
**UC:** UC-10-*, UC-40-*, UC-45-*. **Reglas:** 4, 14, 18–20. **RF:** RF-31 a RF-36 (stub Odoo).

### Sprint 5 — Alquileres y contratos

**Objetivo:** ingreso recurrente con mora viva.

- Misma bandeja `kind=alquiler`.
- `suggestedMonthlyRent` / riesgo A–D / descuento por plazo.
- Firma, cronograma, primera cuota adelantada.
- Mora calculada (`America/Lima`).
- Servicio mid-contract one-shot o financiado.
- Devolución → reabre UC-30-09.

**Entrega:** contrato 12 meses riesgo A; el gerente ve cuotas atrasadas sin marcarlas.  
**UC:** UC-50-*. **Regla:** 15. **Conflictos:** C-10, C-11, C-20, C-24.

### Sprint 6 — Despachos

**Objetivo:** no sale un contenedor sin DAM, fotos, precinto y vigilante. El despacho de venta **ya viene programado por el comercial** (UC-45-12); Almacén no inventa la fecha.

- Motor único venta/alquiler/almacenaje.
- Parciales por camión.
- Flota + unique diario (C-04).
- Verificación 5 fotos; autorizar guía (regla 3); salida física (regla 13).
- Libera patio solo al final.
- Rechazo si se intenta crear despacho de venta sin `pago_validado`.

**Entrega:** venta de 3 unidades en 2 camiones en 2 días; intento de guía sin DAM bloqueado.  
**UC:** UC-60-*. **Reglas:** 3, 10–13. **Conflictos:** C-02, C-05, C-06.

### Sprint 7 — Motor de fletes

**Objetivo:** cotizar transporte sin tabla muerta; listo para enchufar Maps.

- Interfaz `DistanceProvider` (HaversineProvider primero).
- Terrenos, vehículos, `trucksNeededFor`, 3 márgenes.
- Detección de zona por texto.
- Bloqueo de margen mínimo.
- Snapshot del cálculo en la cotización (C-16).
- Admin de tarifario (ya anclado en Config).

**Entrega:** flete a Cusco (sierra) más caro/lento que a Ica a km comparables en línea recta.  
**UC:** UC-70-*. **Regla:** 5.

### Sprint 8 — Costos de terceros y CxP operativa

**Objetivo:** completar la cola que nació en el sprint 2.

- Registro de monto/proveedor sobre pendientes.
- Costos libres por concepto de catálogo.
- 5 métodos de prorrateo.
- Pagado / no pagado.
- Snapshot de `C_T` al vender (C-09).
- Estado agregado por servicio en la factura de compra.

**Entrega:** un mes después de la compra, Compras carga el flete y el 40' paga el doble que el 20' (TEU).  
**UC:** UC-80-*.

### Sprint 9 — Configuración completa, analítica y trazabilidad

**Objetivo:** el dueño opera el negocio sin tocar código.

- Completar las 10 secciones de Configuración (flags de patio, flota, visibilidad, alquiler).
- Analítica (gráficos según §2.4).
- Informe de contenedor imprimible con fotos.
- KPIs de equipo para Gerente.
- Reglas 16 y 17.
- Personas 100 % (clientes riesgo A–D, proveedores).

**Entrega:** el gerente activa “agrupar por fabricante” y el próximo `bestSlotFor` lo respeta.  
**UC:** UC-90-*. **RF:** RF-24, RF-25.

### Sprint 10 — Correo, Maps y conector Odoo real

Orden:

1. **Correo** (SMTP real): cotización, “hay un comprobante por validar”, “el cliente pide descuento”, reserva por expirar, pago rechazado.
2. **WhatsApp** (Cloud API o `wa.me` como el prototipo, luego API) para el mismo aviso al comercial.
3. **Google Maps Distance Matrix** detrás de `DistanceProvider`.
4. **Odoo JSON-2 / XML-RPC:** reemplaza el noop de S4. Mapeo: `customers` → `res.partner`, quote cerrada → `sale.order`, voucher validado → `account.payment`, extras → order lines. Idempotencia por `odoo_sync_queue`.

**No entra:** pasarela de tarjetas. **No entra:** SUNAT.

**Entrega:** un cierre validado en staging aparece como orden + pago en el Odoo del cliente.  
**UC:** UC-45-13. **RF:** RF-36.

### Sprint 11 — Endurecimiento, datos, go-live

- Pruebas de concurrencia (C-01, C-03) automatizadas.
- Carga: 2.000+ unidades, 4 depósitos.
- Backup/restore ensayado.
- Migración de datos reales (si hay Excel histórico): **toda posición pasa por `bestSlotFor`**, nunca INSERT de coordenadas crudas (implicancia de la Fase 2).
- Apagar seed demo; checklist de seguridad (headers, rate limit login, secretos).
- Capacitación por rol con el mismo recorrido que `smoke_full7`.
- Runbook Docker (up, logs, backup, rotación de certificados).

**Entrega:** producción interna en el patio piloto (recomendado: **Callao**).

### Calendario visual

```
S0  Infra + UI shell + logo + contratos Odoo/DealClose
S1  RBAC + maestros
S2  Compras + ISO + DAM
S3  Patio + media
S4  Catálogo + cierre comercial (descuento, voucher, validación, extras, despacho)
S5  Alquileres (cuotas usan el mismo motor de voucher)
S6  Despachos de patio
S7  Fletes
S8  CxP terceros
S9  Config + reportes
S10 Odoo real + correo + Maps
S11 Go-live patio piloto
```

Un recorte de MVP **operable** es **S0–S9** con Odoo en cola (noop). El patio piloto puede vender sin Odoo en línea; no puede vender sin validación comercial del comprobante.

---

## 11. Estrategia de pruebas

El prototipo tiene 21 E2E Playwright + 1 smoke de 5 roles. Eso se **porta**, no se tira.

| Capa | Qué cubre | Cuándo |
|---|---|---|
| Unitario de dominio | ISO, patio, flete, mora, reglas jerárquicas, Incoterm extras | Cada PR; oráculo = funciones actuales del HTML |
| API | 403 por rol, 409 de locks, DAM, guía | Desde S1 |
| Concurrencia | Dos `bestSlotFor`, dos reservas del mismo ISO | S3–S4 y S11 |
| E2E Playwright | Flujos de interfaz contra el stack Docker | Portar `functional_test*` a medida que exista cada pantalla |
| Visual | Comparación de topbar, card, subtab activo, PDP | S0 y S4 |
| Restore | Backup → compose down → restore → smoke | S11 |

Regla de CI: **no merge a `main` si falla un test de las 17 reglas ya implementadas**.

---

## 12. Seguridad y cumplimiento

- Contraseñas argon2; JWT corto + refresh en httpOnly cookie (preferible a localStorage).
- RBAC en cada handler; tests negativos por rol.
- Uploads: content-type allowlist (jpeg/png/webp/mp4), tamaño máximo, virus scan opcional en S11.
- Presigned URLs con expiración corta; las fotos de inspección no son públicas (el catálogo sirve derivadas o URLs firmadas).
- No loguear ISO + datos de cliente juntos en logs públicos.
- Ley de protección de datos personales (Ley 29733): consentimiento en el formulario de cotización pública; derecho de acceso/supresión en backlog post-MVP.
- El prototipo permite manipular estado desde la consola: en producción el cliente es no confiable.

---

## 13. Migración desde el prototipo (trabajo concreto de ingeniería)

1. Extraer funciones de dominio del HTML a un paquete `zdry-domain` con tests que clonan entradas/salidas actuales.
2. Implementar API que llama a ese paquete (una sola implementación de `bestSlotFor`).
3. Reconstruir cada `*Html()` como componente React usando los mismos class names (`.panel`, `.subtab`, `.btn-primary`, `.data`, `.tile`…) para no rediseñar.
4. Sustituir el brand CSS por `<img src="/brand/LOGO_Z.png" alt="ZDRY">`.
5. Mantener el HTML original en `/legacy/zdry_prototype_26.html` **solo en staging** como oráculo visual, no en producción.
6. Semilla: portar `seedSixMonthOperatingHistory` al seeder de Prisma, incluyendo la compactación final de patio.

---

## 14. Riesgos de proyecto (además de los conflictos de runtime)

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Reescribir el patio “más simple” y perder las 4 reglas | Patio físicamente mentiroso | Prohibido asignar x,y,z sin `bestSlotFor`; review obligatorio |
| Rediseñar la UI “porque React” | Retraso y pérdida de validación de negocio | Tokens y class names del HTML son contrato |
| Maps se deja para “después” y se cotiza mal | Pérdida o sobreprecio de flete | Label “estimado”; validar rutas sierra/selva con 10 viajes reales antes de S10 |
| Meter facturación fiscal en ZDRY | Retrasa el patio y duplica Odoo | Fuera de alcance; Odoo factura |
| Cerrar ventas sin validar el voucher | Asignar stock sobre dinero que no está | Reglas 18–20; wizard UC-45 obligatorio en S4 |
| Un solo depósito piloto con datos sucios | Compactación imposible | Carga inicial pasa por validador; unidades ilegales quedan “sin posición” visibles en badge |
| Equipo nuevo no entiende Incoterm | Cola de extras mal generada | La regla sigue en código; no hay editor visual del árbol (igual que el prototipo) — documentar cada logística en Config como texto de ayuda |
| Alcance de “ERP contable” | Nunca se cierra | Contabilidad = Odoo (§1.4, §1.5) |

---

## 15. Go-live — checklist

Patio piloto (Callao):

- [ ] Compose de producción con TLS, backups y secretos.
- [ ] Usuarios reales de los 5 roles; impersonación de staging apagada.
- [ ] Depósitos, tipos, categorías, proveedores y flota cargados.
- [ ] Al menos una factura de compra real + DAM de una unidad de prueba.
- [ ] Recepción con 9 fotos en MinIO y slot válido.
- [ ] Una cotización de venta: reserva → voucher → validación comercial (incl. ensayo interbancario “en verificación”) → asignación → despacho.
- [ ] Ensayo de descuento pre-pago: cliente habla con comercial, precio recongelado, piso de lista respetado.
- [ ] Un despacho completo con guía bloqueada (sin DAM) y luego autorizada (con DAM).
- [ ] Informe de trazabilidad impreso con logo.
- [ ] Reserva de 48 h expiró sola **y** una reserva con voucher pendiente **no** expiró.
- [ ] Payload Odoo encolado tras asignación (noop en MVP; real en S10).
- [ ] Vendedor no puede leer `C_T` (prueba de pentest liviana / curl).
- [ ] Restore de backup ensayado.
- [ ] Runbook entregado al operador.

---

## 16. Backlog posterior al MVP (no olvidar, no mezclar)

- Versionado y rollback de reglas de precio (C-23).
- Borrador + aprobación de cambio global.
- Snapshots históricos de mora (el prototipo no los tiene).
- App de patio offline-first.
- Multi-moneda PEN/USD.
- Conciliación bancaria (en Odoo, no en ZDRY).
- Mejoras del conector Odoo (devoluciones, notas de crédito).
- Editor visual del árbol Incoterm (hoy es código).
- Distance Matrix + peajes reales.
- Notificaciones push al stackero.
- Portal del cliente ampliado (contrato, cuotas, historial de vouchers).

---

## 17. Inventario de pantallas vs. sprints (para diseño/front)

| Pantalla | Origen HTML | Sprint | Notas de fidelidad |
|---|---|---|---|
| Login interno | Nueva | 0 | Fondo navy, logo completo + tagline |
| Catálogo (hero + grid) | `#view-catalog` | 4 | Copiar CSS del hero y `.quickfilter` |
| PDP + lightbox | `#overlay`, `#lightboxOverlay` | 4 | Zoom click, thumbs 5+video |
| Carrito / solicitud | `.quote-modal` | 4 | Pill naranja del topbar |
| Cuenta cliente — reserva | Nueva | 4 | Chat descuento, upload voucher, extras, estado del hold |
| Comercial — negociación | Nueva | 4 | Hilo pre-pago; aplicar descuento hasta piso |
| Comercial — pagos por validar | Nueva | 4 | Wizard: voucher → verificación → extras → asignar → despacho |
| Dashboard Admin — 5 subtabs | `renderAdmin` | 1, 2, 9 | Subtab activo naranja |
| Analítica SVG | `inventoryAnalyticsHtml` | 9 | Barras navy, no chart.js de colores libres |
| Personas | `adminPeopleHtml` | 1, 9 | |
| Configuración | `configuracionHtml` | 1 stub, 9 full | Panel azul `#f0f7ff` de encabezado |
| Gerente — reglas de precio | `gerentePricingHtml` | 4, 9 | Badges de scope |
| Vendedor — inventario + KPI | `renderVendedor` | 4, 5 | Progress de meta |
| Bandeja / seguimiento / extras / flete | `vendorInboxHtml`, `trackingHtml`, `freightCalcHtml` | 4, 7 | |
| Contratos de alquiler | `vendorRentalsHtml` | 5 | Mismo voucher que venta |
| Compras — 3 subtabs | `renderCompras` | 2, 8 | Badges ámbar |
| Almacén recepción | `almacenRecepcionHubHtml` | 3 | Checklist dashed → green |
| Almacén patio | `almacenLayoutHtml` | 3 | La más crítica visualmente |
| Almacén despachos | `almacenDespachosHtml` | 6 | Entra ya programado por comercial |
| Informe imprimible | `containerFullReportHtml` | 9 | CSS `@media print` del prototipo |
| Esquema BD | `#view-schema` | — | No va a producción; opcional `/admin/docs` |

---

## 18. Resumen ejecutivo para negocio

ZDRY ya tiene, en un HTML, un supermercado de contenedores con reglas de patio, ISO, DAM, precios, alquileres, despachos y fletes. Ese HTML **no es el sistema**: no guarda, no autentica, no soporta dos personas a la vez y no habla con Odoo.

El plan maestro propone:

1. **No rediseñar** pantallas ni reglas; portar el diseño del prototipo y el logo `LOGO_Z.png`.
2. **Envolver** la lógica en API + Postgres + Redis + MinIO, todo en Docker.
3. **Construir por las mismas fases** que el documento técnico (porque las dependencias de negocio son reales).
4. **Cerrar la venta con un comercial**, no con un clic: el cliente puede pedir descuento **antes de pagar**; luego sube el comprobante; el comercial valida (el interbancario demora); informa movimientos de patio y ofrece transporte; confirma el ISO y programa el despacho. Recién ahí se empujará a **Odoo**. ZDRY **no se integra a SUNAT**.
5. **Tratar patio, reserva, voucher y guía** como zonas de conflicto: locks, estados partidos (comercial vs físico) y las reglas 1–20 en el servidor.
6. **Salir en ~6 meses** a un patio piloto (sprints 0–9) con el cierre humano ya vivo; Odoo real y Maps en S10.

El criterio de éxito no es “verse moderno”. Es que un cliente no se lleve un contenedor con un voucher en el aire, que un comercial no mueva patio sin haber avisado el costo, y que al día siguiente **los datos sigan ahí**.

---

*Plan v1.1 — `zdry_prototype_26.html`, `ZDRY_Documentacion_Tecnica.md` (v1.0), marca `LOGO_Z.png`. Cierre comercial y Odoo definidos el 31-ago-2026. Cualquier cambio de regla debe actualizar este archivo y el paquete `zdry-domain` a la vez.*

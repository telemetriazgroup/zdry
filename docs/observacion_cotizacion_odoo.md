# Observación: réplica del PDF de cotización Odoo dentro de ZDRY

Para analizar después. No es el canónico de [ruta_cotizacion_zdry.md](ruta_cotizacion_zdry.md) (Q0–Q7) ni de [cotizacion_dry.md](cotizacion_dry.md) (patrón venta/alquiler). Este archivo fija **por qué no se puede extraer el PDF oficial** y **cómo se reconstruye** el reporte «Perú – Presupuesto/Pedido versión 2».

**Fecha de la observación:** 2026-09-21 / 2026-09-22  
**Ambiente:** ZDRY local (`localhost:28080/zdry`) + Odoo staging  
**Reporte Odoo:** `sale.report_saleorder_copy_1_copy_4`  
**Caso ancla:** `COT-2026-0007` → SO `10020263884` (id Odoo ~55327) · NESTLE PERU S A · RUC `20263322496` · ISO `CIMU2022411` · USD 3,500.00 sin IGV

---

## 1. Problema

Q3 asumía: emitir `sale.order` draft y **bajar el PDF QWeb oficial** (`render_qweb_pdf` / `_render_qweb_pdf` / HTTP `/report/pdf/...`) para guardarlo en MinIO y dárselo al cliente.

En Odoo 18 eso no funciona por RPC:

| Intento | Resultado |
|---------|-----------|
| `ir.actions.report.render_qweb_pdf` | Método no expuesto / no existe en el modelo remoto |
| `ir.actions.report._render_qweb_pdf` | Privado; Odoo 18 lo bloquea en XML-RPC |
| Sesión HTTP `/web/session/authenticate` + `/report/pdf/<report>/<id>` | Error de servidor o sin cookie de sesión usable |
| Caso Nestlé al remitir | `QuoteEvent`: `odoo_pdf_error` / `odoo_mail_error` → **Access Denied** |

Consecuencia: la SO **sí se crea** en Odoo (número oficial visible), pero ZDRY no obtiene el bytes del PDF Studio. Un stub de ~2.8 KB se llegó a guardar como si fuera el reporte. No se puede “extraer el PDF directamente”.

**Decisión tomada:** no clonar el QWeb. Reconstruir el mismo documento en ZDRY con datos ya persistidos + logo de marca.

---

## 2. Qué tiene el PDF oficial (validado contra 10020263884)

Captura de referencia: cotización Nestlé abierta en el visor de Odoo (1 página A4, membrete ZGROUP). OCR del visor deforma tildes; la estructura es esta.

### 2.1 Membrete ZGROUP (no es ZDRY)

- Logo: oso polar + wordmark **ZGROUP** + tagline **INGENIERÍA EN FRÍO**
- Slogan derecha: **LÍDERES EN LA CADENA DE FRÍO**
- `ZGROUP S.A.C. - RUC: 20521180774`
- `Calle Ordoner Vargas 142 / Lima / Perú`

### 2.2 Bloque cliente (derecha)

- Razón social SUNAT: `NESTLE PERU S A`
- Domicilio fiscal (calle + distrito + ciudad + país):  
  `CAL. LUIS GALVANI NRO 493 URB. LOTIZACION INDUSTRIAL SAN-ATE-Lima-Perú`
- Teléfono, correo, **Contacto**, teléfono otra vez, **VAT:** RUC
- Iconos de pin / teléfono / sobre (Studio)

En este SO el Contacto impreso fue **Valeria Vendedor** (el upsert de partner usó el nombre del vendedor ZDRY). El comercial de la cabecera fue **Eusebio Avellaneda** (`sale.order.user_id` en Odoo, no el vendor de ZDRY).

### 2.3 Cabecera comercial

- `COTIZACIÓN N°: 10020263884` (nombre del SO, no el `COT-…`)
- Referencia: `COT-2026-0007` (en el visor se lee 00007; en BD ZDRY es `COT-2026-0007`)
- Fecha de presupuesto: `09/21/2026` (formato **MM/DD/YYYY**, no DD/MM)
- Validez de la oferta: `09/29/2026` en el PDF Odoo
- Comercial: Eusebio Avellaneda

### 2.4 Asunto + líneas

- Barra navy: `VENTA DE CONTENEDOR DRY 40 HC SEGUNDO USO`
- Columnas: N · DESCRIPCIÓN · PRECIO UNIT · CANT · PRECIO FINAL
- Línea 1: `CIMU2022411 - CONTENEDOR DRY 40 HC SEGUNDO USO` · `3,500.00` · `1.00` · `$ 3,500.00`
- Precios **sin IGV** (`No incluyen IGV`)

### 2.5 Condiciones (defaults de emisión, no del cliente)

| Campo | Valor en el PDF oficial |
|-------|-------------------------|
| Precio | No incluyen IGV |
| Forma de pago | Immediate Payment |
| Tipo de moneda | Dolares Americanos |
| Validez de la Oferta | 7 DÍAS |
| Tiempo de entrega | SEGÚN PROGRAMACIÓN |
| Lugar de entrega | ZGROUP CALLAO |

### 2.6 Cuentas corrientes ZGROUP

Son las **cuentas de la empresa en el reporte Studio**, no las cuentas voucher de cobro ZDRY.

| Tipo | Banco | Cuenta / CCI |
|------|-------|----------------|
| CTA. CORRIENTE | BANCO DE CRÉDITO DEL PERÚ - MONEDA DOLARES | `191-1755511-1-67 / 00219100175551116756` |
| CTA. CORRIENTE | BANCO DE CRÉDITO DEL PERÚ - MONEDA SOLES | `191-1876416-0-95 / 00219100187641609550` |
| CTA. CORRIENTE | SCOTIABANK - MONEDA DOLARES | `0003812201 / 00908100000381220116` |
| CTA. CORRIENTE | SCOTIABANK - MONEDA SOLES | `0000035893 / 00908100000003589311` |
| CTA. CORRIENTE | BBVA PERÚ - MONEDA DOLARES | `0011-0261-00-00327322 / 01126100010003273258` |
| DETRACCIÓN | BANCO DE LA NACIÓN - MONEDA SOLES | `00-0030011740` |

### 2.7 Notas

`NO INCLUYE:` transporte/manipuleo en destino, viáticos a provincia, medicinas/homologaciones, plano/soldado/pintado (equipo en el estado encontrado).  
Términos: `https://www.zgroup.com.pe/terms`  
Cierre: `Payment terms: Immediate Payment`

### 2.8 Qué **no** imprime el PDF oficial

- Estado SUNAT (`ACTIVO`) ni condición (`HABIDO`) — sí viven en partner / ficha ZDRY
- Número interno ZDRY como título (solo como Referencia)
- Cuentas de pago del portal ZDRY
- IGV desglosado en la tabla (el neto es el precio de línea)

---

## 3. Información válida para reconstruir (contrato)

Cada bloque del PDF Odoo tiene una fuente en ZDRY. Si falta esa fuente, el PDF sale incompleto; no se inventa desde Odoo.

| # | Bloque | Fuente ZDRY | Campo / función |
|---|--------|-------------|-----------------|
| 1 | Membrete + logo | Constante de marca | `ZGROUP_LETTERHEAD` + `apps/api/src/assets/zg_marca.png` |
| 2 | Cliente | SUNAT EYM vía `zdry_lookup_sunat` | `Customer.companyName`, `rucDni`, `street`, `district`, `province`, `department`, `phone`, `email` |
| 2b | Contacto | Primer usuario de la cuenta | `User.name` donde `customerId` = cliente (no el vendedor) |
| 3 | N° cotización | SO Odoo | `Quote.odooSaleName` o, si aún no hay SO, `Quote.number` |
| 4 | Referencia | Correlativo ZDRY | `Quote.number` |
| 4b | Fechas | Emisión + defaults | `createdAt` → `formatPeDate` (America/Lima, MM/DD/YYYY); validez = `validityDate` + `validityDays` (7) |
| 4c | Comercial | Asesor ZDRY | `vendor.name` |
| 5 | Asunto | Tipo + uso de líneas | `saleAsunto(kind, measure, usage)` |
| 6 | Líneas | Cotización congelada | `QuoteLine.iso`, `type`, `cat`, `priceNet`; extras > 0 |
| 7 | Condiciones | Config emisión Q0 | `paymentTermName`, `deliveryTime`, `deliveryPlace`, `validityLabel` |
| 8 | Bancos | Letterhead (no voucher) | `ZGROUP_LETTERHEAD.banks` |
| 9 | NO INCLUYE | Texto fijo Q0 | `DEFAULT_QUOTE_NOTE` |

SUNAT (payload EYM que sí sirve para el PDF):

- `ok`, `source=eym`, `vat`, `name`
- `street`, `district`, `province`, `department`, `ubigeo`
- `taxpayer_state` (ACTIVO), `taxpayer_condition` (HABIDO) — **ficha, no PDF**

Domicilio impreso (réplica): `{street}-{district}-{city}-Perú` si el distrito/ciudad no van ya en `street`.  
Ejemplo Nestlé: `CAL. LUIS GALVANI NRO 493 URB. LOTIZACION INDUSTRIAL SAN-ATE-LIMA-Perú`.

Logo: PNG `zg_marca.png` (oso + ZGROUP, sin tagline). El tagline **INGENIERÍA EN FRÍO** se dibuja debajo. `nest-cli` copia `assets/**/*` a `dist/`. Raster con Jimp → XObject `/Im1` en el PDF Helvetica WinAnsi.

---

## 4. Proceso implementado (réplica total en ZDRY)

```
solicitar cotización
    → Quote dealStatus=nueva
    → QuoteIssueWorker: partner SUNAT + sale.order draft (número Odoo)
    → remitIssuedQuote
        → QuotePdfService.capture()
            → si hay PDF zdry válido en MinIO: reusar
            → si no (o el guardado era stub odoo): renderLocal()
                → buildPeruV2Report(...)
                → renderPeruV2Pdf(report, zg_marca.png)
                → MinIO  quotes/{id}/presupuesto-{saleName}.pdf
                → Quote.pdfSource = "zdry"
        → postToSale(): adjunto ir.attachment + message_post en el SO
    → dealStatus=cotizada
    → GET /quotes/:id/pdf  → Presupuesto - {odooSaleName}.pdf
```

UI: Cuenta / hub «Descargar cotización (Perú v2)» cuando `odoo.pdf.ready` (`pdfSource` `odoo` o `zdry`).

Código:

| Pieza | Archivo |
|-------|---------|
| Contrato 9 bloques | `apps/api/src/domain/peru-v2-report.ts` |
| Render A4 + logo | `apps/api/src/domain/peru-v2-pdf.ts` |
| Captura / MinIO / adjunto | `apps/api/src/odoo-import/quote-pdf.service.ts` |
| Descarga | `QuotesService.pdf` → `quotePdf.capture` |
| Tests | `apps/api/src/domain/peru-v2-report.spec.ts` |
| Logo | `apps/api/src/assets/zg_marca.png` |
| Q3 legado (ya no es el camino feliz) | `apps/api/src/domain/odoo-quote-pdf.ts` |
| Worker | `quote-issue-worker.service.ts` → `capture` + `postToSale` |

`captureFromOdoo` queda en el servicio por si un día el RPC/HTTP vuelve a entregar QWeb. **No se usa** en `capture()`.

Verificado 2026-09-22: `GET /quotes/cc1f6660-e707-4df5-b24f-9d89ada57bac/pdf` → 208546 bytes `%PDF-1.4`, `pdfSource=zdry`, evento `PDF Perú v2 (réplica ZDRY) 10020263884`.

---

## 5. Desfases Odoo vs réplica (para decidir después)

| Tema | PDF Odoo 10020263884 | Réplica ZDRY | Pregunta abierta |
|------|----------------------|--------------|------------------|
| Comercial | Eusebio Avellaneda (`user_id` del SO) | Valeria Vendedor (`Quote.vendor`) | ¿Leer `user_id` al renderizar o persistir el comercial Odoo? |
| Contacto | Valeria Vendedor (bug del upsert: se mandó el vendor) | luis marcelo (usuario de la cuenta) | La réplica es más correcta. ¿Corregir partner Odoo para que el QWeb, si algún día vuelve, no mienta? |
| Validez (fecha) | 09/29/2026 | 09/28/2026 (`createdAt` + 7 días Lima) | Off-by-one. ¿Odoo suma 8, o el visor/TZ? Label en ambos: 7 DÍAS |
| Formato fecha | MM/DD/YYYY | MM/DD/YYYY (Lima) | Replicado a propósito. ¿Pasar a DD/MM para Perú? |
| Iconos Studio | pin / teléfono / sobre | Cuadros navy | Cosmético |
| Tagline bajo el logo | Parte del wordmark Studio | Texto `INGENIERÍA EN FRÍO` | El PNG de marca no trae el tagline |
| Adjunto al chatter | Falló Access Denied al extraer QWeb | `postToSale` puede colgar la réplica | Re-remitir `COT-2026-0007` para dejar el PDF en el SO |
| Numeración ZDRY | Visor: COT-2026-00007 | BD: `COT-2026-0007` | Confirmar padding del correlativo |

---

## 6. Riesgos / no mezclar

- **Cuentas del PDF ≠ cuentas voucher ZDRY.** Cambiar letterhead afecta el documento comercial oficial; no el cobro del portal.
- **No guardar stubs.** `capture()` solo reusa MinIO si `pdfSource === "zdry"` y el buffer pasa `pdfLooksLikePeruV2`. Un PDF `odoo` viejo o truncado se vuelve a renderizar.
- **RUC sin razón social EYM** (ej. intentos `20607354643`): partner incompleto → bloque cliente vacío. Hidratar SUNAT **antes** de emitir el SO.
- **Cronograma de alquiler** sigue siendo otro reporte Odoo (`zgroup_subscription_report.report_proyeccion_template`). Esta réplica es solo presupuesto venta/alquiler Perú v2, no el cronograma.
- Q3 en [ruta_cotizacion_zdry.md](ruta_cotizacion_zdry.md) todavía dice `render_qweb_pdf` + MinIO. Quedó desactualizado: el camino feliz es la réplica.

---

## 7. Cómo repetir el análisis

1. Abrir en Odoo el SO `10020263884` (o uno nuevo) y el reporte Perú v2. Anotar los 9 bloques; no confiar en OCR.
2. En ZDRY: ficha de `COT-2026-0007` — razón, domicilio, ACTIVO/HABIDO, ISO, `odooSaleName`.
3. Descargar `GET /quotes/{id}/pdf` (o «Descargar cotización (Perú v2)»).
4. Comparar: número SO, SUNAT, línea, bancos, NO INCLUYE, logo.
5. Si se cambia Studio (bancos, notas, plazo), actualizar `ZGROUP_LETTERHEAD` / `DEFAULT_QUOTE_NOTE` / defaults Q0; no hay sync automático con el QWeb.

Caso útil de control: misma Nestlé, misma línea `CIMU2022411` a 3500. Si el PDF ZDRY no trae `10020263884` + `GALVANI` + `3,500.00` + RUC empresa `20521180774`, la réplica se rompió.

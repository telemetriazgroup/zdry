# Datos DRY — patrones, bordes y plan integral

Copia operativa. Canónico: `zgroup/documentacion/datos_dry.md`. **No implementa.**

Muestra Odoo staging (20-sep-2026): **500** SO asunto `*dry*` + **36** DRY+REEFER. Casos ancla: Pichari alquiler `100202616899`, IMEXCAL venta `100202628772`.

## Patrones a automatizar

| Id | Qué | ZDRY |
|----|-----|------|
| P1 | Venta DRY 20/40, precio+ISO en la misma línea, USD | J5 / `sale_close` |
| P2 | Alquiler: servicio cobrado + ISO a 0 + plan mensual | Post-J5 |
| P3 | Flete / manipuleo / recojo como extra o SO hija | `QuoteExtra` |
| P4 | N ISO / mix 20+40 | Carrito |
| P5 | Callao vs Sullana/Piura | Depósito |
| P6 | Coti de referencia (transporte, garantía, retorno) | `parentQuoteId` |
| P7 | CRM seguimiento → cerrado-facturado / perdido | Semáforo `dealStatus` + J2 |
| P8 | Voucher humano antes de despachar | Ya en deal-close |

## No automatizar (consultar comercial)

Modulares/planos, módulos revestidos, modificaciones, furgón/open top/flat rack, 30–150 unidades, mix reefer, campañas, garantías sueltas.

## WhatsApp

No reutilizar el proceso de [zgroup-bot](file:///home/telemetriazgroup/Proyectos/zgroup-bot) (alarmas IMEI). Sí copiar: outbox, opt-in, intenciones, historial, `POST` de evento. Canal prod: Cloud API. Servicio nuevo `zdry-wa`. Comercial recibe el lead; cliente hace `ESTADO`.

Módulo superadmin `/app/estadistica-dry`: archivo local de las 2203 SO DRY (venta/alquiler/otros) con líneas, OUT/IN, facturas, notas, imágenes y PDF. Ranking de comerciales, comparativa A vs B y mes a mes (cotización / proceso / facturado). No implementa J5.

## Plan

A datos → B quote auto (casi hay) → C `zdry-wa` piloto → D J5 P1 → E eventos a web/WA → F alquiler/flete → G bordes.

Cierre de stock/factura **sigue siendo humano** (`proyecto_zdry.md` §1.5).

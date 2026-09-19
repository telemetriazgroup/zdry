# J0 — Madurez actual y plan conjunto

Fecha: 19-sep-2026. No implementa código: fija de dónde partimos.

---

## 1. Madurez ZDRY (código real)

### Ya está (usable)

| Área | Evidencia |
|------|-----------|
| Infra Docker, auth, RBAC | `admin`, `gerente`, `vendedor`, `compras`, `coordinador`, `almacen`, `superadmin` |
| Conexión Odoo JSON-2 | `OdooClient.probe`, credenciales superadmin |
| Bandeja candidatos DRY a la mano | `OdooLotCandidate`, sync por `write_date` **manual** (“Buscar en Odoo”) |
| Asimilar sin bloquear ISO | Crea `Container`, `intakeOrigin=odoo`, no publica web |
| Write-back de ficha | `OdooFieldWriteback`, icono live/deferred; no pisa `localTouched` |
| Deuda OC/factura | Referencias en candidato/container; Compras enlaza |
| Patio campo + coordinador | `campoEnabledAt`, fotos, evaluación, GateVisit, costos de patio, documentos |
| Cierre comercial **local** | Máquina `dealStatus`, voucher, reserva; `OdooSyncJob` se **crea** |
| Tests de dominio | ISO, yard, odoo-lot-map, odoo-purchase, watermark, gate-visit, commercial (~18 spec) |

### A medias o stub

| Pieza | Qué falta |
|-------|-----------|
| `OdooClient.enqueueSaleClose` | Solo **loga**. No crea `sale.order` |
| `OdooSyncJob` | Payload `{quoteId, isos, evento}`; nadie lo procesa contra Odoo |
| Fase 6 “delta continuo” | El sync manual cubre el primer delta; no hay push desde Odoo |
| Origen del lote | No se lee trazabilidad. Todo asimilado parece “Odoo con OC en deuda” |
| Precio de ajustes | No existe referencial admin |
| Conciliación reentrega ↔ IN | Reentrega existe (`logistics=reentrega`); no hay bandeja de match |
| Fotos → Odoo | Se **bajan** del chatter; no hay política “subir solo una” |
| Semáforo comercial Odoo | No hay `odooSaleId` ni lectura de `invoice_status` / picking |

### Fuera de ZDRY (correcto)

SUNAT, GRE fiscal, asientos, conciliación bancaria.

---

## 2. Madurez Odoo 17 (`zgroup`)

| Pieza | Estado |
|-------|--------|
| Ficha lote DRY (`date_sotck_move`) | Lista (color, tara, DUA, fabricante…) |
| OC → IN parcial/total | **Nativo**. Ningún addon overridea `button_confirm` / `button_validate` de compras |
| Warning sobre-recepción | `zgroup_stock` (no bloquea) |
| GRE | `pe_sunat_guide_override` (solo outgoing) |
| **`zgroup_zdry_bridge`** | **No existe** |
| Usuario API DRY | No está acotado en este repo |

---

## 3. Orden del plan conjunto

```
J1  ZDRY clasifica origen + precio referencial     (sin módulo Odoo nuevo)
J2  Odoo emite eventos DRY  +  ZDRY los consume    (primer código Odoo)
J3  ZDRY concilia reentrega cuando llega el IN
J4  ZDRY escribe 1 foto + nota; no satura filestore
J5  Cierre: SO real y semáforo facturado/despachado
J6  Delta “ya no a la mano”, QA, patio piloto
```

Dependencias:

- J2 no requiere J1 para *existir*, pero J3 **sí** requiere J1 (saber si el match trae costo) y se beneficia de J2 (enterarse del IN sin pulsar “Buscar”).
- J5 requiere J1 (no vender ajuste sin referencial) y J2 (estados de vuelta).
- J4 es independiente de J5; puede ir en paralelo con J3.

---

## 4. Repos y ramas sugeridas

| Repo | Ruta docs | Código |
|------|-----------|--------|
| Odoo `zgroup` | `documentacion/fases/` | `zgroup_zdry_bridge/` a partir de J2 |
| ZDRY `zdry` | `docs/fases_conjunto/` | `apps/api/src/odoo-import`, `quotes`, `purchases` |

Misma numeración **J1…J6** en ambos lados.

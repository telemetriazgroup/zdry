# J2 — Puente de eventos Odoo → ZDRY

Copia operativa. Canónica: `zgroup/documentacion/fases/J2-puente-eventos.md`.

**Implementado 19-sep-2026.**

## ZDRY

- Dominio `applyOdooEvent` / `mapLotPayloadToOwned` (specs).
- `POST /zdry/api/internal/odoo-events` + `X-Zdry-Webhook-Secret`.
- Worker 45 s: `search_read zdry.sync.event` pending (si el addon está instalado).
- Write-back de ficha con `context: { zdry_sync: true }`.
- Conflictos `localTouched` en `OdooFieldConflict` (ficha).
- «Buscar en Odoo» = forzar. «Leer eventos» = poll.

## Secreto

`ODOO_ZDRY_WEBHOOK_SECRET` (env) o `AppSetting` `odoo_webhook_secret`.

## Hecho cuando

- [x] Endpoint + apply vs localTouched.
- [x] Anti-eco.
- [ ] Instalar / actualizar `zgroup_zdry_bridge` **17.0.1.1.0** en staging Odoo y pegar el webhook.

Expediente (diff + documentos + notas): [j2_expediente.md](j2_expediente.md).

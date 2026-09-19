# J6 — Operación continua y endurecimiento

**Lidera:** ambos. Cierra el patio piloto DRY.

## Objetivo

El sistema se mantiene solo: lotes nuevos, “ya no a la mano”, sin saturar Odoo, con QA repetible.

## Trabajo Odoo

- Evento `quant_change` cuando qty interna DRY pasa a 0 (no borrar lote).
- Revisar ACL del usuario API (mínimo privilegio).
- Cron del bridge: reintentos, alerta si pending > N o error > 3.
- No mezclar BD staging con patio real.

## Trabajo ZDRY

1. Aplicar `quant_change` qty 0 → aviso “ya no a la mano en Odoo”; no archivar patio solo.
2. Recálculo del referencial J1 cuando entre `bill_posted`.
3. “Buscar en Odoo” queda como forzar + “reiniciar módulo” (ya existe).
4. Suite E2E conjunta (Playwright ZDRY + 2 lotes staging):
   - Ajuste → referencial → fotos campo → no publica hasta admin.
   - IN/OC → asimilar → conciliar si reentrega → 1 foto a Odoo.
   - Quote → SO → semáforo.
5. Checklist go-live: usuarios reales, token webhook, backup MinIO.

## Pruebas

| Tipo | Qué |
|------|-----|
| Carga | 200 lotes DRY: un sync forzado < límite acordado; eventos < 1 s/write |
| Concurrencia | Dos write-back + un write Odoo en el mismo lote → un conciliar, no silent overwrite |
| Restore | Backup ZDRY + eventos pending no se pierden |
| Pentest liviano | Webhook sin token = 401; vendedor no ve `C_T` / ids Odoo |

## Hecho cuando

- [ ] Patio piloto (Callao) regulariza DRY sin pulsar Buscar todo el día.
- [ ] Un lote vendido en Odoo aparece “no a la mano” en ZDRY.
- [ ] Checklist de [implicancias_zdry.md §13](../implicancias_zdry.md) en verde.
- [ ] J1–J5 no regresionan.

## Fuera de J6 (backlog)

Maps, WhatsApp, multi-moneda, editor Incoterm, versionado de reglas de precio, app offline.

# Plan conjunto ZDRY + Odoo 17

Este directorio es la hoja de implementación **en el repo ZDRY**. El mismo plan vive en Odoo: `zgroup/documentacion/fases/`.

Misma numeración. Desarrollar **una fase a la vez**, con las pruebas de la ficha.

| Fase | Nombre | Lidera | Estado |
|------|--------|--------|--------|
| [J0](00-madurez-y-plan.md) | Madurez y contrato | Docs | Hecha |
| [J1](J1-origen-y-precio.md) | Origen ajuste vs IN + precio referencial | ZDRY | Hecho (local) — [corrección OC](j1_correcion.md) · [fabricación](j1_fabricacion.md) |
| [J2](J2-puente-eventos.md) | Consumir `zdry.sync.event` / webhook | Odoo + ZDRY | **Cerrado** 19-sep-2026 · [expediente](j2_expediente.md) |
| [J3](J3-conciliar-reentrega.md) | Match reentrega ↔ OC/IN | ZDRY | Hecho (local) 19-sep-2026 |
| [J4](J4-foto-unica.md) | Una foto de referencia a Odoo | ZDRY | Pendiente |
| [J5](J5-cierre-comercial.md) | Worker `sale_close` real + semáforo | Ambos | Pendiente |
| [J6](J6-continuo-y-endurecer.md) | Delta continuo + E2E | Ambos | Pendiente |

Negocio: `implicancias_integrar_odoo.md`, `caso_aplicacion.md`. Patio/coordinador: `plan_ajuste.md` (A–F, ya en código). Integración lectura F0–F5: `fase_integracion_odoo.md` (hecha; F6 la absorbe J2/J6).

## Convención de prueba en ZDRY

```bash
cd apps/api && npm test          # specs de dominio de la fase
# + prueba manual en Docker con coordinador@zdry.pe / compras@zdry.pe
```

Cada PR de fase debe incluir o actualizar un `*.spec.ts` listado en la ficha.

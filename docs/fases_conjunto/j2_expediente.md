# J2.1 — Expediente por serial

Canónica: `zgroup/documentacion/fases/j2_expediente.md`.

Pestaña **Expediente** en la ficha Odoo (timeline, documentos versionados, notas).

El addon Odoo debe **actualizarse** a **17.0.1.1.0** antes de validar hooks reales (`lot_note`, `mo_done`, payload rico). El webhook y el backfill J1 se validan en ZDRY local sin ese paso.

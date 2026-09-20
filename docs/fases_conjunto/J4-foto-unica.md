# J4 — Una foto de referencia en Odoo

**Lidera:** ZDRY. **Odoo:** attachments nativos; el bridge **no** encola binarios.

## Objetivo

Patio guarda 9+ tomas en MinIO. Odoo solo tiene **una** imagen de cara en el chatter del `stock.lot`, para no inflar filestore.

## Trabajo Odoo

- El usuario API puede `create` `ir.attachment` (`res_model=stock.lot`).
- Convención: `name` = `zdry_ref_{iso}.jpg` y `description` = `zdry_ref`. Al reemplazar, **unlink** el attachment anterior con esa marca (desde ZDRY).
- J2: evento `attachment` **opcional** y liviano (id + checksum), no el binario.

## Trabajo ZDRY

1. Campo `odooRefAttachmentId` + slot elegido por coordinador/admin (“Usar como referencia Odoo”).
2. Job: sube **un** JPEG (sin watermark de catálogo). Context `zdry_sync`.
3. Seguir bajando fotos Odoo históricas al inbox (ya existe); no re-subirlas (`InspectionPhoto.source=odoo`).
4. Comentarios extras: un `mail.message` texto, no un hilo por toma.

## Cómo se implementa

1. Coordinador/admin elige una casilla 1–9 de Recepción. La foto debe ser de patio (`source=zdry`), no una bajada del chatter.
2. ZDRY convierte a JPEG (lado ≤ 1600, sin marca de agua) y crea `ir.attachment` en el lote.
3. Antes deja un solo `zdry_ref`: crea el nuevo y **unlink** los anteriores con esa marca. Las 8 casillas restantes no viajan.
4. Un `mail.message` de texto anuncia el cambio de casilla. El inbox de Odoo se sigue listando.

## Pruebas

| Tipo | Qué |
|------|-----|
| Unit | Solo 1 attachment `zdry_ref` por lote tras dos reemplazos |
| API | Publicar 9 fotos ZDRY → Odoo tiene 1 adjunto nuevo |
| Staging | Peso filestore del lote BMOU no crece 8× |
| Regresión | Inbox chatter existente se sigue viendo en Recepción |

Implementado 20-sep-2026 (local): `POST /warehouse/units/:iso/odoo-ref` crea el JPEG y lo publica con `stock.lot.message_post(attachment_ids)` — un `mail.message` de solo texto no muestra la foto en el lote. Unlink de `zdry_ref` previos por nombre. Spec `odoo-ref-photo.spec.ts`.

## Hecho cuando

- [ ] Admin marca “cara Odoo”; Odoo muestra esa foto en el lote.
- [ ] Cambiar la cara reemplaza, no acumula.
- [ ] Las 8 restantes solo están en ZDRY.

## Fuera de J4

Marca de agua pública (ya existe). Video 360 a Odoo (nunca).

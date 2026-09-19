-- J1: origen de ingreso Odoo (ajuste vs OC) y fuente de costo
ALTER TABLE "Container" ADD COLUMN "odooIntakeKind" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooPickingName" TEXT;
ALTER TABLE "Container" ADD COLUMN "costSource" TEXT;

ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooIntakeKind" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooPickingName" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "costSource" TEXT;

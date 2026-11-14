import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser, isSuperadmin } from "../auth/auth.types";
import { StorageService } from "../storage/storage.service";
import { YardLockService } from "../redis/yard-lock.service";
import { inspectIntakeIso } from "../domain/intake-iso";
import { ACTIVE_MASTER } from "../domain/masters";
import { MANUFACTURERS } from "../domain/purchase-extras";
import { CONDITION_GRADES, parseCondition } from "../domain/odoo-purchase";
import { YEAR_MIN } from "../domain/year";
import {
  DEFAULT_DOCUMENT_CONCEPTS,
  mergeCatalogOptions,
  normalizeDocumentConcept,
  normalizeOptionLabel,
} from "../domain/catalog-options";
import { canApplyGateIn, GATE_IN_KEY, presentDepotCost } from "../domain/depot-costs";
import { visitPhotoStatus } from "../domain/gate-visit";
import { EvaluationService } from "../evaluation/evaluation.service";
import {
  needsPatioChoice,
  warehouseFromLocation,
  warehouseLabel,
  zgrouPatioCodes,
} from "../domain/odoo-warehouse";
import { ensureOperationalDepots } from "../odoo-import/depot-map.store";
import { ExpedienteStore } from "../odoo-events/expediente.store";
import { toDispatchExpediente } from "../domain/odoo-doc-present";
import {
  extForInspectionMime,
  MAX_INSPECTION_PHOTO_BYTES,
  MAX_INSPECTION_VIDEO_BYTES,
  sniffInspectionPhotoMime,
  sniffInspectionVideoMime,
} from "../domain/inspection-media";
import { stripVideoAudio } from "../domain/video-process";
import {
  CONTAINER_COLORS,
  DEFAULT_YARD_CONFIG,
  DEPOT_SERVICE_RATES,
  LayoutRules,
  PHOTO_LABELS,
  YardUnit,
  bestSlotFor,
  compactYardGravity,
  containerCommitted,
  defaultCbm,
  inspectDataMissing,
  inspectMissing,
  intakeTypeLabel,
  needsYardPlacement,
  normalizeLayoutRules,
  placeSuccessMessage,
  posLabel,
  validateMove,
} from "../domain/yard";
import { AISLE_SIDE, FENCE_SIDE, STACKER_PLACE_MESSAGE, accessBlockMessage, accessPlaceNote, asBayHalf, baySpan, fenceBays, fenceDepthOf, fenceSeat, fenceSideIndex, fenceSlotCount, fenceWithout, feetOf, ghostsWithSupport, movesToReach, normalizeYardPlan, spansOverlap, stackLengthError, zoneSlotError, type YardPlan } from "../domain/yard-plan";
import { YARD_SCENARIOS, yardScenario } from "../domain/yard-scenarios";
import { YARD_RUMA_TEMPLATES, fillPerimeter, fillRumaTemplate, yardRumaTemplate } from "../domain/yard-rumas";
import { readMovementPolicy } from "../domain/freight-stub";
import { PHOTO_STATUS_ACTIVE, PHOTO_STATUS_REJECTED } from "../domain/catalog-media";
import { OdooClient } from "../odoo/odoo.client";
import { limaDayRange, listOdooLotNotes } from "../odoo/odoo-lot-photos";
import { listOrCacheOdooPhotos, openOrCacheOdooPhoto } from "../odoo-import/odoo-photo-cache.store";
import { ODOO_LOT_SELECT_FALLBACK, receptionOwnedPatch } from "../domain/odoo-lot-map";
import { OdooImportService } from "../odoo-import/odoo-import.service";
import { toOdooRefJpeg } from "../domain/odoo-ref-jpeg";
import {
  ZDRY_REF_DESC,
  ZDRY_SYNC_CONTEXT,
  canPublishOdooRef,
  isZdryRefNoteBody,
  pickZdryRefIdsToUnlink,
  plainChatterBody,
  zdryRefAttachmentName,
  zdryRefMessageBody,
  zdryRefMessagePostKw,
  zdryRefSearchDomain,
} from "../domain/odoo-ref-photo";

const CAMPO_ODOO_LOCKED = [
  "tareKg",
  "mgwKg",
  "color",
  "year",
  "manufacturer",
  "odooDua",
  "originCountry",
  "material",
  "odooDescription",
  "zgroupCode",
  "internalRef",
  "lotCategory",
  "classification",
  "lotCode",
  "numberingDate",
  "manufactureMonth",
  "productTitle",
] as const;

const LAYOUT_RULES_KEY = "layout_rules";
const yardPlanKey = (depotId: string) => `yard_plan:${depotId}`;
const YARD_DEMO_ID = "yard-demo";
const YARD_DEMO_2_ID = "yard-demo-2";
const yardSimKey = (depotId: string) => `yard_sim:${depotId}`;

function isYardDemo(depotId: string) {
  return depotId === YARD_DEMO_ID || depotId === YARD_DEMO_2_ID;
}

function demoDepotName(depotId: string) {
  return depotId === YARD_DEMO_2_ID ? "Depósito demo 2" : "Depósito demo";
}

function fenceHalfFor(sideFeet: 20 | 40, feet: number, raw?: string | null): "A" | "B" | null {
  if (sideFeet === 20) {
    if (feet !== 20) throw new BadRequestException("Ese lado es de 20 pies y este contenedor es de 40.");
    return null;
  }
  if (feet === 40) return null;
  if (raw !== "A" && raw !== "B") {
    throw new BadRequestException("Ese puesto es de 40 pies. Un 20 ocupa la mitad A o la mitad B.");
  }
  return raw;
}

function fenceCellsOverlap(left?: string | null, right?: string | null) {
  if (!left || !right) return true;
  return left === right;
}

function stockDemoYard(
  zones: { name: string; rows: number; cols: number; levels: number }[],
  perimeter: { sides: { id: string; kind: string; containerFeet: 20 | 40; levels: number; wallSlots: number[]; lengthM: number; wallM: number }[] },
  templateId: string,
  stock: { iso: string; feet: number }[],
) {
  const placed = fillRumaTemplate(zones, templateId, stock);
  const used = new Set(placed.map((item) => item.iso));
  const fence = fillPerimeter(
    perimeter.sides.map((side) => ({
      id: side.id,
      kind: side.kind,
      containerFeet: side.containerFeet,
      levels: side.levels,
      slots: fenceSlotCount({
        lengthM: side.lengthM,
        kind: side.kind === "contenedores" || side.kind === "mixto" ? side.kind : "pared",
        containerFeet: side.containerFeet === 20 ? 20 : 40,
        wallM: side.wallM,
      }),
      wallSlots: side.wallSlots,
    })),
    stock,
    used,
  );
  return { placed, fence };
}

function fenceLevelSupported(cells: { sideId: string; slot: number; level: number; iso: string; half?: string | null; row?: number; unknown?: boolean }[], sideId: string, slot: number, level: number, half: "A" | "B" | null, iso: string, row = 1) {
  if (level <= 1) return true;
  const below = cells.filter((cell) => cell.sideId === sideId && cell.slot === slot && cell.level === level - 1 && (cell.row || 1) === row && (cell.unknown || cell.iso !== iso));
  if (!half) {
    return below.some((cell) => !cell.half) || (below.some((cell) => cell.half === "A") && below.some((cell) => cell.half === "B"));
  }
  return below.some((cell) => !cell.half || cell.half === half);
}

type YardSimPlacement = {
  iso: string;
  lado: string;
  ruma: number | null;
  columna: number | null;
  nivel: number | null;
  half?: "A" | "B" | null;
};
type YardSimHistory = { id: string; iso: string; type: string; detail: string; createdAt: string };
type YardSim = {
  placements: YardSimPlacement[];
  history: YardSimHistory[];
  scenarioId?: string;
  withPerimeter?: boolean;
  rumaTemplateId?: string;
};

function simMeta(sim: YardSim) {
  return {
    ...(sim.scenarioId ? { scenarioId: sim.scenarioId } : {}),
    withPerimeter: sim.withPerimeter === true,
    ...(sim.rumaTemplateId ? { rumaTemplateId: sim.rumaTemplateId } : {}),
  };
}
const YARD_CONFIG_KEY = "yard_config";
const COLORS_KEY = "container_colors";
const MANUFACTURERS_KEY = "container_manufacturers";
const DOCUMENTS_KEY = "document_concepts";

export const DOCUMENT_CONCEPTS = [
  { id: "eir", label: "Recibo de intercambio de equipo (EIR)" },
  { id: "constancia_conductor", label: "Constancia de conductor" },
  { id: "otro", label: "Otro" },
] as const;

export function hideOdooFor(role: string) {
  return role === "almacen";
}

export function hideOdooIdsFor(role: string) {
  return role === "almacen" || role === "coordinador";
}

export function hideRatesFor(role: string) {
  return role === "almacen" || role === "coordinador";
}

type ContainerRow = Prisma.ContainerGetPayload<{
  include: { depot: true; photos: true; ownerCustomer: { select: { id: true; companyName: true; rucDni: true } } };
}>;

const ACTIVE_PHOTOS = { where: { status: PHOTO_STATUS_ACTIVE } };

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly locks: YardLockService,
    private readonly odoo: OdooClient,
    private readonly evaluation: EvaluationService,
    private readonly odooImport: OdooImportService,
  ) {
    this.expediente = new ExpedienteStore(prisma);
  }

  private readonly expediente: ExpedienteStore;

  async getLayoutRules(): Promise<LayoutRules> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: LAYOUT_RULES_KEY } });
    return normalizeLayoutRules(row?.value);
  }

  async putLayoutRules(input: Partial<LayoutRules>, user: AuthUser, ip?: string) {
    const value = normalizeLayoutRules({ ...(await this.getLayoutRules()), ...input });
    await this.prisma.appSetting.upsert({
      where: { key: LAYOUT_RULES_KEY },
      update: { value },
      create: { key: LAYOUT_RULES_KEY, value },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "AppSetting",
      entityId: LAYOUT_RULES_KEY,
      after: value as object,
      ip,
    });
    return value;
  }

  async getYardPlan(depotId: string): Promise<YardPlan> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: yardPlanKey(depotId) } });
    return normalizeYardPlan(row?.value);
  }

  async saveYardPlan(depotId: string, input: unknown, user: AuthUser, ip?: string) {
    if (isYardDemo(depotId)) this.assertYardDemo(user);
    else {
      const depot = await this.prisma.depot.findUnique({ where: { id: depotId } });
      if (!depot) throw new NotFoundException("Depósito no encontrado.");
    }
    return this.locks.withYardLock(depotId, async () => {
      const previous = await this.getYardPlan(depotId);
      const value = normalizeYardPlan(input);
      const removed = previous.zones.filter((zone) => !value.zones.some((next) => next.id === zone.id));
      await this.releaseRemovedZones(depotId, removed.map((zone) => zone.name));
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value },
        create: { key: yardPlanKey(depotId), value },
      });
      await this.audit.log({
        user,
        action: "update",
        entity: "AppSetting",
        entityId: yardPlanKey(depotId),
        after: value as object,
        ip,
      });
      return value;
    });
  }

  private async releaseRemovedZones(depotId: string, names: string[]) {
    const zones = [...new Set(names.map((name) => name.trim()).filter((name) => name && name !== FENCE_SIDE && name !== AISLE_SIDE))];
    if (!zones.length) return;
    if (isYardDemo(depotId)) {
      const sim = await this.readYardSim(depotId);
      const freed = sim.placements.filter((item) => zones.includes(item.lado));
      if (!freed.length) return;
      const now = new Date().toISOString();
      await this.writeYardSim(depotId, {
        placements: sim.placements.filter((item) => !zones.includes(item.lado)),
        history: [
          ...freed.map((item) => ({
            id: randomUUID(),
            iso: item.iso,
            type: "Movimiento",
            detail: `Simulación: volvió a sin sitio porque se quitó la zona ${item.lado}.`,
            createdAt: now,
          })),
          ...sim.history,
        ],
        ...simMeta(sim),
      });
      return;
    }
    const units = await this.prisma.container.findMany({
      where: { depotId, lado: { in: zones }, archivedAt: null },
      select: { iso: true, lado: true },
    });
    if (!units.length) return;
    await this.prisma.$transaction(async (tx) => {
      for (const unit of units) {
        await tx.containerPosition.updateMany({ where: { iso: unit.iso, closedAt: null }, data: { closedAt: new Date() } });
        await tx.container.update({
          where: { iso: unit.iso },
          data: { lado: null, ruma: null, columna: null, nivel: null, bayHalf: null },
        });
        await tx.containerHistory.create({
          data: { iso: unit.iso, type: "Movimiento", detail: `Volvió a sin sitio porque se quitó la zona ${unit.lado}.` },
        });
      }
    });
  }

  async setYardGhost(
    input: { depotId?: string; zoneId?: string; row?: number; col?: number; level?: number; occupied?: boolean; code?: string; typeCode?: string; color?: string; note?: string; kind?: string; half?: string; split?: boolean; merge?: boolean },
    user: AuthUser,
    ip?: string,
  ) {
    const depotId = input.depotId || "";
    const plan = await this.getYardPlan(depotId);
    const zone = plan.zones.find((item) => item.id === input.zoneId);
    if (!zone) throw new BadRequestException("Esa zona no está en el plano.");
    const row = Number(input.row);
    const col = Number(input.col);
    const level = Number(input.level);
    const error = zoneSlotError(zone, row, col, level);
    if (error) throw new BadRequestException(error);
    const positions = await this.yardPositions(depotId);
    const typeCode = String(input.typeCode || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 12);
    const span = baySpan(typeCode, input.half);
    const sameLevel = (item: { lado?: string | null; ruma?: number | null; columna?: number | null; nivel?: number | null }) =>
      item.lado === zone.name && item.ruma === row && item.columna === col && item.nivel === level;
    const taken = positions.find((item) => sameLevel(item) && spansOverlap(baySpan(item.type, item.bayHalf), span));
    if (taken) throw new ConflictException(`${taken.iso} ya está identificado en esa posición.`);
    if (input.occupied === false) {
      const aboveUnit = positions.find((item) => item.lado === zone.name && item.ruma === row && item.columna === col && (item.nivel || 0) > level && spansOverlap(baySpan(item.type, item.bayHalf), span));
      const aboveGhost = plan.ghosts.some((ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level > level && spansOverlap(baySpan(ghost.typeCode, ghost.half), span));
      if (aboveUnit || aboveGhost) {
        throw new BadRequestException("Hay equipos encima. Identifica o mueve esos antes de liberar este hueco.");
      }
    }
    if (input.occupied !== false && typeCode) {
      const below = positions.filter((item) => item.lado === zone.name && item.ruma === row && item.columna === col && (item.nivel || 0) < level);
      const problem = stackLengthError(
        zone,
        plan.ghosts,
        below.map((item) => ({ zoneName: zone.name, row, col, level: item.nivel || 0, type: item.type, half: asBayHalf(item.bayHalf), iso: item.iso })),
        typeCode,
        row,
        col,
        level,
        span === "full" ? null : span,
      );
      if (problem) throw new ConflictException(problem);
    }
    const code = String(input.code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 20);
    if (code && code !== "DESCONOCIDO" && input.occupied !== false) {
      const existing = await this.prisma.container.findUnique({
        where: { iso: code },
        select: { iso: true, depotId: true, archivedAt: true },
      });
      if (existing && !existing.archivedAt) {
        throw new ConflictException(
          isYardDemo(depotId) || existing.depotId === depotId
            ? "Ese código ya está en este almacén. Elígelo en la lista y tócalo en la celda."
            : "Ese código ya existe en otro almacén.",
        );
      }
    }
    const half = span === "A" || span === "B" ? span : undefined;
    if (input.merge) {
      const atCell = (ghost: { zoneId: string; row: number; col: number; level: number }) =>
        ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level === level;
      const named = plan.ghosts.some((ghost) => atCell(ghost) && ghost.code);
      const sideA = plan.ghosts.some((ghost) => atCell(ghost) && !ghost.code && ghost.half === "A");
      const sideB = plan.ghosts.some((ghost) => atCell(ghost) && !ghost.code && ghost.half === "B");
      if (positions.some((item) => sameLevel(item)) || named || !sideA || !sideB) {
        throw new ConflictException("Solo se fusionan dos desconocidos, uno en cada mitad. Un equipo identificado no se fusiona.");
      }
      const cleared = plan.ghosts.filter((ghost) => !atCell(ghost));
      cleared.push({ zoneId: zone.id, row, col, level });
      const supported = ghostsWithSupport(
        plan.zones,
        cleared,
        positions
          .filter((item) => item.lado && item.ruma && item.columna && item.nivel)
          .map((item) => ({ zoneName: item.lado || "", row: item.ruma || 0, col: item.columna || 0, level: item.nivel || 0, iso: item.iso, type: item.type, half: asBayHalf(item.bayHalf) })),
      );
      const saved = await this.saveYardPlan(depotId, { ...plan, ghosts: supported }, user, ip);
      await this.audit.log({ user, action: "fusionar puesto", entity: "Yard", entityId: zone.name, after: { depotId, row, col, level }, ip });
      return saved;
    }
    if (input.split) {
      const busy = positions.some((item) => sameLevel(item));
      if (busy) throw new ConflictException("Esa altura ya tiene un equipo identificado.");
      const cleared = plan.ghosts.filter(
        (ghost) => !(ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level === level),
      );
      cleared.push(
        { zoneId: zone.id, row, col, level, half: "A", typeCode: "20" },
        { zoneId: zone.id, row, col, level, half: "B", typeCode: "20" },
      );
      const supported = ghostsWithSupport(
        plan.zones,
        cleared,
        positions
          .filter((item) => item.lado && item.ruma && item.columna && item.nivel)
          .map((item) => ({ zoneName: item.lado || "", row: item.ruma || 0, col: item.columna || 0, level: item.nivel || 0, iso: item.iso, type: item.type, half: asBayHalf(item.bayHalf) })),
      );
      const saved = await this.saveYardPlan(depotId, { ...plan, ghosts: supported }, user, ip);
      await this.audit.log({ user, action: "dividir puesto", entity: "Yard", entityId: zone.name, after: { depotId, row, col, level }, ip });
      return saved;
    }
    const previous = plan.ghosts.find((ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level === level && spansOverlap(baySpan(ghost.typeCode, ghost.half), span));
    const ghosts = plan.ghosts.filter(
      (ghost) => !(ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level === level && spansOverlap(baySpan(ghost.typeCode, ghost.half), span)),
    );
    if (input.occupied !== false) {
      const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color || "")) ? String(input.color).toLowerCase() : "";
      const note = String(input.note || "").trim().slice(0, 120);
      const kind = String(input.kind || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 24);
      const mark = { ...(half ? { half } : {}), ...(color ? { color } : {}), ...(note ? { note } : {}), ...(kind ? { kind } : {}) };
      ghosts.push(code
        ? { zoneId: zone.id, row, col, level, code, typeCode, ...mark }
        : { zoneId: zone.id, row, col, level, ...mark });
    }
    const stacked = positions;
    const supported = ghostsWithSupport(
      plan.zones,
      ghosts,
      stacked
        .filter((item) => item.lado && item.ruma && item.columna && item.nivel)
        .map((item) => ({ zoneName: item.lado || "", row: item.ruma || 0, col: item.columna || 0, level: item.nivel || 0, iso: item.iso, type: item.type, half: asBayHalf(item.bayHalf) })),
    );
    const saved = await this.saveYardPlan(depotId, { ...plan, ghosts: supported }, user, ip);
    const pending = !code || code === "DESCONOCIDO";
    const action = input.occupied === false
      ? (previous?.code && previous.code !== "DESCONOCIDO" ? "eliminar equipo" : "quitar desconocido")
      : pending
        ? (previous ? "modificar desconocido" : "ocupar desconocido")
        : (previous?.code === code ? "modificar equipo" : "ubicar equipo");
    await this.audit.log({
      user,
      action,
      entity: "Yard",
      entityId: code || previous?.code || "DESCONOCIDO",
      after: { depotId, zone: zone.name, row, col, level, kind: String(input.kind || ""), note: String(input.note || "") },
      ip,
    });
    return saved;
  }

  async saveOutsider(
    input: { depotId?: string; id?: string; code?: string; feet?: number; color?: string; note?: string; kind?: string; remove?: boolean },
    user: AuthUser,
    ip?: string,
  ) {
    const depotId = input.depotId || "";
    if (isYardDemo(depotId)) this.assertYardDemo(user);
    else {
      const depot = await this.prisma.depot.findUnique({ where: { id: depotId } });
      if (!depot) throw new NotFoundException("Depósito no encontrado.");
    }
    const code = String(input.code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 20);
    return this.locks.withYardLock(depotId, async () => {
      const plan = await this.getYardPlan(depotId);
      const outsiders = [...plan.outsiders];
      if (input.remove) {
        const current = outsiders.find((item) => item.id === input.id);
        if (!current) throw new NotFoundException("Ese equipo no está en el depósito.");
        for (const item of current.media || []) {
          await this.storage.delete(item.storageKey).catch(() => undefined);
        }
        const value = {
          ...plan,
          outsiders: outsiders.filter((item) => item.id !== current.id),
          ghosts: plan.ghosts.filter((ghost) => ghost.code !== current.code),
          perimeter: { ...plan.perimeter, cells: plan.perimeter.cells.filter((cell) => !(cell.unknown && cell.iso === current.code)) },
        };
        await this.prisma.appSetting.upsert({
          where: { key: yardPlanKey(depotId) },
          update: { value },
          create: { key: yardPlanKey(depotId), value },
        });
        await this.audit.log({ user, action: "eliminar equipo", entity: "Yard", entityId: current.code, after: { depotId, kind: current.kind }, ip });
        return normalizeYardPlan(value);
      }
      if (!code || code === "DESCONOCIDO") throw new BadRequestException("Escribe el código del equipo que no es ZDRY.");
      const feet: 10 | 20 | 40 = Number(input.feet) === 10 ? 10 : Number(input.feet) === 40 ? 40 : 20;
      const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color || "")) ? String(input.color).toLowerCase() : "";
      const note = String(input.note || "").trim().slice(0, 120);
      const kind = String(input.kind || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 24) || "OTROS";
      const existingUnit = await this.prisma.container.findUnique({ where: { iso: code }, select: { archivedAt: true } });
      if (existingUnit && !existingUnit.archivedAt) throw new ConflictException("Ese código ya está en el inventario ZDRY.");
      const current = input.id ? outsiders.find((item) => item.id === input.id) : undefined;
      if (input.id && !current) throw new NotFoundException("Ese equipo no está en el depósito.");
      if (outsiders.some((item) => item.code === code && item.id !== current?.id)) throw new ConflictException("Ese código ya está asimilado en este depósito.");
      const row = {
        id: current?.id || randomUUID(),
        code,
        feet,
        ...(color ? { color } : {}),
        ...(note ? { note } : {}),
        kind,
        ...(current?.media?.length ? { media: current.media } : {}),
      };
      const previousCode = current?.code;
      const typeCode = String(feet);
      const ghosts = plan.ghosts.map((ghost) => {
        if (!previousCode || ghost.code !== previousCode) return ghost;
        return {
          zoneId: ghost.zoneId,
          row: ghost.row,
          col: ghost.col,
          level: ghost.level,
          code,
          typeCode,
          ...(ghost.half ? { half: ghost.half } : {}),
          ...(color ? { color } : {}),
          ...(note ? { note } : {}),
          kind,
        };
      });
      const cells = plan.perimeter.cells.map((cell) => {
        if (!previousCode || !cell.unknown || cell.iso !== previousCode) return cell;
        return {
          sideId: cell.sideId,
          slot: cell.slot,
          level: cell.level,
          iso: code,
          unknown: true as const,
          typeCode,
          ...(cell.half ? { half: cell.half } : {}),
          ...(cell.row ? { row: cell.row } : {}),
          ...(color ? { color } : {}),
          ...(note ? { note } : {}),
          kind,
        };
      });
      const value = {
        ...plan,
        outsiders: current ? outsiders.map((item) => (item.id === current.id ? row : item)) : [...outsiders, row],
        ghosts,
        perimeter: { ...plan.perimeter, cells },
      };
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value },
        create: { key: yardPlanKey(depotId), value },
      });
      await this.audit.log({
        user,
        action: current ? "modificar equipo" : "crear equipo",
        entity: "Yard",
        entityId: code,
        after: { depotId, kind, feet, note },
        ip,
      });
      return normalizeYardPlan(value);
    });
  }

  async meta(user?: AuthUser) {
    const [types, categories, depots, customers, rules, colorRow, mfrRow, docRow, concepts, evalCatalog] = await Promise.all([
      this.prisma.containerType.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.category.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.depot.findMany({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }),
      this.prisma.customer.findMany({ where: await this.prisma.hideDemo(), orderBy: { companyName: "asc" } }),
      this.getLayoutRules(),
      this.prisma.appSetting.findUnique({ where: { key: COLORS_KEY } }),
      this.prisma.appSetting.findUnique({ where: { key: MANUFACTURERS_KEY } }),
      this.prisma.appSetting.findUnique({ where: { key: DOCUMENTS_KEY } }),
      this.prisma.depotCostConcept.findMany({ where: { active: true }, orderBy: [{ system: "desc" }, { label: "asc" }] }),
      this.evaluation.presentCatalog(),
    ]);
    const maxY = new Date().getFullYear();
    const years: number[] = [];
    for (let y = maxY; y >= YEAR_MIN; y--) years.push(y);
    const hideRates = user ? hideRatesFor(user.role) : false;
    const zgrouPatios = depots
      .filter((d) => zgrouPatioCodes().includes((d.code || "") as "principal" | "gambeta_1" | "gambeta_2"))
      .map((d) => ({ id: d.id, code: d.code, name: d.name, city: d.city }));
    return {
      types,
      categories,
      depots: depots.map((d) => ({
        ...d,
        pending: d.code === "callao_pendiente",
        zgrouChoice: zgrouPatioCodes().includes((d.code || "") as "principal" | "gambeta_1" | "gambeta_2"),
      })),
      zgrouPatios,
      customers,
      manufacturers: mergeCatalogOptions(MANUFACTURERS, mfrRow?.value),
      colors: mergeCatalogOptions(CONTAINER_COLORS, colorRow?.value),
      yearMin: YEAR_MIN,
      yearMax: maxY,
      photoLabels: PHOTO_LABELS,
      conditionGrades: CONDITION_GRADES,
      yardConfig: DEFAULT_YARD_CONFIG,
      layoutRules: rules,
      years,
      serviceRates: hideRates ? null : DEPOT_SERVICE_RATES,
      costConcepts: concepts.map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        amount: hideRates ? null : Number(c.amount),
      })),
      documentConcepts: mergeCatalogOptions(DEFAULT_DOCUMENT_CONCEPTS, docRow?.value).map((label) => ({
        id: label,
        label,
      })),
      documentConceptLabels: mergeCatalogOptions(DEFAULT_DOCUMENT_CONCEPTS, docRow?.value),
      maxPhotoBytes: MAX_INSPECTION_PHOTO_BYTES,
      maxVideoBytes: MAX_INSPECTION_VIDEO_BYTES,
      ...evalCatalog,
      odooSelects: await this.odooImport.lotSelects().catch(() => ({ ...ODOO_LOT_SELECT_FALLBACK })),
    };
  }

  async validateIso(raw: string) {
    const inspected = inspectIntakeIso(raw);
    if (!inspected.ok) {
      return { valid: false, checkOk: false, duplicate: false, reason: inspected.message, isoException: true };
    }
    const existing = await this.prisma.container.findUnique({
      where: { iso: inspected.isoNormalized },
      select: { iso: true, status: true },
    });
    return {
      ...inspected.check,
      code: inspected.isoNormalized,
      duplicate: !!existing,
      existingStatus: existing?.status || null,
      isoException: inspected.isoException,
      isoExceptionReason: inspected.isoExceptionReason,
    };
  }

  async rentalReturns() {
    const rows = await this.prisma.quote.findMany({
      where: {
        kind: "alquiler",
        dealStatus: { notIn: ["perdida", "expirada"] },
        odooPickingState: "done",
        OR: [{ odooPickingInState: null }, { odooPickingInState: { not: "done" } }],
      },
      include: {
        lines: true,
        customer: { select: { companyName: true, rucDni: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((q) => ({
      id: q.id,
      number: q.number,
      odooSaleName: q.odooSaleName,
      customer: q.customer.companyName,
      pickingName: q.odooPickingName,
      pickingInName: q.odooPickingInName,
      pickingInState: q.odooPickingInState,
      isos: q.lines.map((l) => l.iso),
    }));
  }

  pending(user?: AuthUser) {
    return this.receptionRows(user, false);
  }

  /** Unidades ya enviadas a campo. La ficha es la misma: el coordinador puede corregir. */
  validated(user?: AuthUser) {
    return this.receptionRows(user, true);
  }

  /** Asimiladas cuyo último movimiento es una salida. No están en pendientes ni en el catálogo. */
  async atCustomer(user?: AuthUser) {
    const live = await this.prisma.liveContainers();
    const seeArchived = isSuperadmin(user?.role);
    const [types, categories, rows] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.container.findMany({
        where: {
          status: "Vendido",
          intakeOrigin: "odoo",
          ...(seeArchived ? (live.demo === false ? { demo: false as const } : {}) : live),
        },
        include: { depot: true, photos: { where: { status: PHOTO_STATUS_ACTIVE }, select: { id: true } } },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    const typeMap = Object.fromEntries(types.map((t) => [t.code, t]));
    const catMap = Object.fromEntries(categories.map((c) => [c.code, c]));
    return rows.map((c) => ({
      iso: c.iso,
      type: c.type,
      typeLabel: typeMap[c.type]?.label || c.type,
      cat: c.cat,
      catLabel: catMap[c.cat]?.label || c.cat,
      catColor: catMap[c.cat]?.color || "#495057",
      depotId: c.depotId,
      depotName: c.depot.name,
      intakeType: c.intakeType,
      intakeLabel: intakeTypeLabel(c.intakeType),
      intakeOrigin: c.intakeOrigin,
      isoException: c.isoException,
      odooLocation: c.odooLocation,
      odooWarehouse: c.odooWarehouse || warehouseFromLocation(c.odooLocation),
      odooWarehouseLabel: warehouseLabel(c.odooWarehouse || warehouseFromLocation(c.odooLocation)),
      needsPatioChoice: false,
      depotCode: c.depot.code,
      status: c.status,
      registeredByName: c.registeredByName || "—",
      createdAt: c.createdAt,
      campoEnabledAt: c.campoEnabledAt,
      campoEnabledByName: c.campoEnabledByName || "",
      waitingCampo: false,
      archived: !!c.archivedAt,
      archiveReason: c.archiveReason || "",
      archivedByName: c.archivedByName || "",
      archivedAt: c.archivedAt,
      missing: ["Salida a cliente. No está en pendientes ni en el catálogo."],
    }));
  }

  private async receptionRows(user: AuthUser | undefined, sent: boolean) {
    const live = await this.prisma.liveContainers();
    const seeArchived = isSuperadmin(user?.role);
    const [types, categories, rows] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.container.findMany({
        where: {
          status: { not: "Vendido" },
          ...(seeArchived ? (live.demo === false ? { demo: false as const } : {}) : live),
        },
        include: { depot: true, photos: { where: { status: PHOTO_STATUS_ACTIVE }, select: { id: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const typeMap = Object.fromEntries(types.map((t) => [t.code, t]));
    const catMap = Object.fromEntries(categories.map((c) => [c.code, c]));
    const lotIds = rows.map((c) => c.odooLotId).filter((id): id is number => typeof id === "number" && id > 0);
    const photoGroups = lotIds.length
      ? await this.prisma.odooCachedPhoto.groupBy({
          by: ["odooLotId"],
          where: { odooLotId: { in: lotIds }, kind: { not: "zdry_ref" } },
          _count: { _all: true },
        })
      : [];
    const photosByLot = new Map(photoGroups.map((g) => [g.odooLotId, g._count._all]));
    const list = rows
      .map((c) => {
        const missing = inspectMissing({
          ...c,
          photoCount: c.intakeOrigin === "odoo" ? c.photos.length : undefined,
        });
        const waitingCampo = !c.campoEnabledAt;
        if (sent ? waitingCampo : !waitingCampo) return null;
        if (user?.role === "almacen" && c.intakeOrigin === "odoo") return null;
        return {
          iso: c.iso,
          type: c.type,
          typeLabel: typeMap[c.type]?.label || c.type,
          cat: c.cat,
          catLabel: catMap[c.cat]?.label || c.cat,
          catColor: catMap[c.cat]?.color || "#495057",
          depotId: c.depotId,
          depotName: c.depot.name,
          intakeType: c.intakeType,
          intakeLabel: intakeTypeLabel(c.intakeType),
          intakeOrigin: c.intakeOrigin,
          isoException: c.isoException,
          odooLocation: user?.role === "admin" || user?.role === "superadmin" || user?.role === "coordinador" ? c.odooLocation : null,
          odooWarehouse: c.odooWarehouse || warehouseFromLocation(c.odooLocation),
          odooWarehouseLabel: warehouseLabel(c.odooWarehouse || warehouseFromLocation(c.odooLocation)),
          needsPatioChoice: needsPatioChoice(c.odooWarehouse || warehouseFromLocation(c.odooLocation), c.depot.code),
          depotCode: c.depot.code,
          status: c.status,
          registeredByName: c.registeredByName || "—",
          createdAt: c.createdAt,
          campoEnabledAt: c.campoEnabledAt,
          campoEnabledByName: c.campoEnabledByName || "",
          waitingCampo,
          odooPhotoCount: c.odooLotId ? photosByLot.get(c.odooLotId) || 0 : 0,
          archived: !!c.archivedAt,
          archiveReason: c.archiveReason || "",
          archivedByName: c.archivedByName || "",
          archivedAt: c.archivedAt,
          missing: c.archivedAt
            ? [`Archivada${c.archiveReason ? `: ${c.archiveReason}` : ""}`]
            : sent
            ? (missing.length ? missing : [`En campo${c.campoEnabledByName ? ` · ${c.campoEnabledByName}` : ""}`])
            : waitingCampo && !missing.length ? ["Pendiente de enviar a campo"] : missing,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (sent) return list;
    return list.sort(
      (a, b) =>
        (b.odooPhotoCount || 0) - (a.odooPhotoCount || 0) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async dispatchExpediente(iso: string) {
    const row = await this.prisma.container.findUnique({ where: { iso }, select: { iso: true } });
    if (!row) throw new NotFoundException("Unidad no encontrada.");
    const presented = await this.expediente.present(row.iso);
    return toDispatchExpediente(presented);
  }

  async getUnit(iso: string, opts: { hideOdoo?: boolean; hideOdooIds?: boolean; hideRates?: boolean; includeArchive?: boolean } = {}) {
    await this.odooImport.hydrateReceptionFicha(iso).catch(() => undefined);
    const c = await this.loadUnit(iso, !!opts.includeArchive);
    await this.evaluation.importLegacyForUnit(c.iso, c);
    const [types, categories, rules, extras] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.getLayoutRules(),
      this.loadUnitExtras(c.iso, !!opts.hideRates, !!opts.includeArchive),
    ]);
    const occupants = (await this.prisma.container.findMany({ where: { depotId: c.depotId, lado: { not: null } } })).map(
      toYardUnit,
    );
    const suggested = bestSlotFor(occupants, c.depotId, c.type, c.cat, DEFAULT_YARD_CONFIG, rules);
    return { ...this.presentUnit(c, types, categories, suggested, opts.hideOdoo, opts.hideOdooIds), ...extras };
  }

  async setUnitRating(
    iso: string,
    body: { conceptId?: string; levelId?: string; reason?: string; note?: string; source?: "patio" | "recepcion" | "catalogo" },
    user: AuthUser,
    ip?: string,
  ) {
    await this.loadUnit(iso);
    await this.evaluation.setRating(iso, body, user, ip);
    return this.presentFor(iso, user);
  }

  private presentFor(iso: string, user: AuthUser) {
    return this.getUnit(iso, {
      hideOdoo: hideOdooFor(user.role),
      hideOdooIds: hideOdooIdsFor(user.role),
      hideRates: hideRatesFor(user.role),
      includeArchive: user.role === "superadmin",
    });
  }

  async intake(
    input: {
      category?: string;
      iso?: string;
      type?: string;
      cat?: string;
      depotId?: string;
      customerId?: string;
      discount?: number;
      enableCampo?: boolean;
    },
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role === "almacen") {
      throw new ForbiddenException("El personal de campo no registra ingresos. El coordinador habilita las unidades.");
    }
    const category = input.category === "almacenaje_cliente" ? "almacenaje_cliente" : "pendiente_factura";
    const inspected = inspectIntakeIso(input.iso || "");
    if (!inspected.ok) throw new BadRequestException(inspected.message);
    const iso = inspected.isoNormalized;
    const existing = await this.prisma.container.findUnique({ where: { iso } });
    if (existing) throw new ConflictException("Ya existe un contenedor con ese código.");
    if (category === "almacenaje_cliente" && !input.customerId) {
      throw new BadRequestException("Selecciona el cliente dueño de la unidad.");
    }
    const depot = await this.prisma.depot.findUnique({ where: { id: input.depotId || "" } });
    if (!depot || depot.archivedAt) throw new BadRequestException("Depósito de ingreso inválido.");
    const typeRow = await this.prisma.containerType.findUnique({ where: { code: input.type || "" } });
    const catRow = await this.prisma.category.findUnique({ where: { code: input.cat || "" } });
    if (!typeRow || typeRow.archivedAt) throw new BadRequestException("Tipo inválido.");
    if (!catRow || catRow.archivedAt) throw new BadRequestException("Condición inválida.");
    if (category === "almacenaje_cliente") {
      const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw new BadRequestException("Cliente inválido.");
    }
    const discount = Math.max(0, Math.min(100, Number(input.discount) || 0));
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.container.create({
          data: {
            iso,
            type: typeRow.code,
            cat: catRow.code,
            status: category === "almacenaje_cliente" ? "En custodia" : "Pendiente de ingreso",
            year: null,
            manufacturer: "—",
            depotId: depot.id,
            intakeType: category,
            invoicePending: category === "pendiente_factura",
            physicallyReceived: false,
            isoException: inspected.isoException,
            isoExceptionReason: inspected.isoExceptionReason,
            fobCif: 0,
            ownerCustomerId: category === "almacenaje_cliente" ? input.customerId : null,
            storageDiscountPct: category === "almacenaje_cliente" ? discount : 0,
            cbm: defaultCbm(typeRow.code),
            registeredById: user.id,
            registeredByName: user.name,
          },
        });
        await tx.containerHistory.create({
          data: {
            iso,
            type: "Ingreso",
            detail: `Unidad registrada en Recepción por ${user.name} — intake: ${category === "almacenaje_cliente" ? "almacenaje de cliente" : "pendiente de factura"}${inspected.isoException ? " · ISO 6346 en excepción (no bloqueó el alta)." : ""}.`,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Ya existe un contenedor con ese código.");
      }
      throw e;
    }
    await this.audit.log({
      user,
      action: "create",
      entity: "Container",
      entityId: iso,
      after: { iso, intakeType: category, depotId: depot.id, isoException: inspected.isoException },
      ip,
    });
    if (input.enableCampo) {
      return this.enableCampo(iso, user, ip);
    }
    return this.presentFor(iso, user);
  }

  async patchUnit(
    iso: string,
    body: {
      tareKg?: number;
      mgwKg?: number;
      color?: string;
      cat?: string;
      year?: number | string | null;
      manufacturer?: string;
      inspectionNotes?: string;
      odooDua?: string;
      originCountry?: string;
      material?: string;
      odooDescription?: string;
      zgroupCode?: string;
      internalRef?: string;
      lotCategory?: string;
      classification?: string;
      lotCode?: string;
      numberingDate?: string;
      manufactureMonth?: string;
      productTitle?: string;
      conditionFloor?: string | null;
      conditionRoof?: string | null;
      conditionDoors?: string | null;
      conditionPaint?: string | null;
      conditionWalls?: string | null;
      roofHole?: boolean | null;
    },
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.loadUnit(iso);
    if (user.role === "almacen" && c.intakeOrigin === "odoo") {
      const locked = CAMPO_ODOO_LOCKED.filter((k) => body[k] !== undefined);
      if (locked.length) {
        throw new ForbiddenException("El operario de patio no modifica datos de Odoo. Solo fotos y notas de campo.");
      }
    }
    const data: Prisma.ContainerUpdateInput = {};
    if (body.tareKg !== undefined || body.mgwKg !== undefined) {
      const tareKg = body.tareKg !== undefined ? Math.max(0, Math.round(Number(body.tareKg) || 0)) : c.tareKg;
      const mgwKg = body.mgwKg !== undefined ? Math.max(0, Math.round(Number(body.mgwKg) || 0)) : c.mgwKg;
      data.tareKg = tareKg;
      data.mgwKg = mgwKg;
      data.payloadKg = Math.max(0, mgwKg - tareKg);
    }
    if (body.color !== undefined) data.color = body.color || "—";
    if (body.cat !== undefined) {
      const catRow = await this.prisma.category.findUnique({ where: { code: body.cat } });
      if (!catRow) throw new BadRequestException("Condición inválida.");
      data.cat = body.cat;
    }
    if (body.year !== undefined) {
      const raw = body.year == null ? "" : String(body.year).trim();
      if (!raw) data.year = null;
      else if (/^\d{4}$/.test(raw)) {
        const year = Number(raw);
        const max = new Date().getFullYear() + 1;
        if (year < 1960 || year > max) throw new BadRequestException(`El año debe estar entre 1960 y ${max}.`);
        data.year = year;
      }
    }
    if (body.manufacturer !== undefined) data.manufacturer = body.manufacturer || "—";
    if (body.inspectionNotes !== undefined) data.inspectionNotes = String(body.inspectionNotes || "");
    if (body.odooDua !== undefined) data.odooDua = String(body.odooDua || "").trim() || null;
    if (body.originCountry !== undefined) data.originCountry = String(body.originCountry || "").trim() || null;
    if (body.material !== undefined) data.material = String(body.material || "").trim() || null;
    if (body.odooDescription !== undefined) data.odooDescription = String(body.odooDescription || "");
    const lotKeys = ["zgroupCode", "internalRef", "lotCategory", "classification", "lotCode", "numberingDate", "manufactureMonth", "productTitle"] as const;
    if (body.year !== undefined || lotKeys.some((key) => body[key] !== undefined) || body.color !== undefined) {
      const prev = c.odooSource && typeof c.odooSource === "object" && !Array.isArray(c.odooSource)
        ? { ...(c.odooSource as Record<string, unknown>) }
        : {};
      if (body.year !== undefined) prev.yearToken = body.year == null || body.year === "" ? null : String(body.year).trim();
      if (body.color !== undefined) prev.color = body.color || null;
      for (const key of lotKeys) {
        if (body[key] !== undefined) prev[key] = String(body[key] || "").trim() || null;
      }
      data.odooSource = prev as Prisma.InputJsonValue;
    }
    for (const key of ["conditionFloor", "conditionRoof", "conditionDoors", "conditionPaint", "conditionWalls"] as const) {
      if (body[key] !== undefined) data[key] = parseCondition(body[key]) || null;
    }
    if (body.roofHole !== undefined) data.roofHole = body.roofHole == null || body.roofHole === ("" as never) ? null : !!body.roofHole;
    await this.prisma.container.update({ where: { iso: c.iso }, data });
    await this.evaluation.syncLegacyFields(
      c.iso,
      {
        conditionFloor: body.conditionFloor,
        conditionRoof: body.conditionRoof,
        conditionDoors: body.conditionDoors,
        conditionPaint: body.conditionPaint,
        conditionWalls: body.conditionWalls,
      },
      user,
      ip,
      "patio",
    );
    await this.audit.log({
      user,
      action: "update",
      entity: "Container",
      entityId: c.iso,
      after: data as object,
      ip,
    });
    const owned = receptionOwnedPatch(body);
    let writeback: { ok: boolean; flushed?: number; skipped?: boolean; message?: string } | null = null;
    if (c.odooLotId && Object.keys(owned).length) {
      writeback = await this.odooImport.writebackFromUnit(c.iso, owned, "recepcion_save");
    }
    const unit = await this.presentFor(c.iso, user);
    return {
      ...unit,
      writeback,
      saveMessage:
        !c.odooLotId || !Object.keys(owned).length
          ? undefined
          : writeback?.skipped
            ? undefined
            : writeback?.ok
              ? "Guardado en ZDRY y actualizado en Odoo."
              : `Guardado en ZDRY. Odoo no aceptó el cambio: ${writeback?.message || "error"}`,
    };
  }

  async relinkOdooReference(iso: string, user: AuthUser, ip?: string) {
    const result = await this.odooImport.relinkUnitReference(iso);
    const moved = result.previousLotId && result.previousLotId !== result.odooLotId;
    await this.prisma.containerHistory.create({
      data: {
        iso: result.iso,
        type: "Referencia Odoo",
        detail: `${user.name} reinició la referencia. Lote Odoo ${result.odooLotId}${moved ? ` (antes ${result.previousLotId})` : ""}. ${result.notes} nota(s) de ese lote. La ficha de esta serie se copió a su lote.`,
      },
    });
    await this.audit.log({
      user,
      action: "odoo_relink",
      entity: "Container",
      entityId: result.iso,
      after: { odooLotId: result.odooLotId, previousLotId: result.previousLotId, notes: result.notes },
      ip,
    });
    const unit = await this.presentFor(result.iso, user);
    const writeback = result.writeback;
    return {
      ...unit,
      relink: result,
      saveMessage: writeback && writeback.ok === false
        ? `Referencia enlazada al lote ${result.odooLotId}. Odoo no aceptó la ficha: ${writeback.message || "error"}`
        : `Referencia reiniciada. La ficha quedó en el lote ${result.odooLotId} y las notas son solo de esa serie.`,
    };
  }

  async acceptIsoReview(iso: string, note: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    if (!c.isoException) return this.presentFor(iso, user);
    const reason = [c.isoExceptionReason, note.trim() || `Revisado por ${user.name}`].filter(Boolean).join(" · ");
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { isoException: false, isoExceptionReason: reason },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "ISO 6346",
        detail: `Excepción ISO marcada como revisada por ${user.name}. ${note.trim() || "Serial Odoo aceptado para operación."}`,
      },
    });
    await this.audit.log({
      user,
      action: "iso_review",
      entity: "Container",
      entityId: c.iso,
      after: { isoException: false },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async uploadMedia(
    iso: string,
    slotRaw: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.loadUnit(iso);
    if (user.role === "almacen") {
      throw new ForbiddenException("El personal de campo sube tomas a la bandeja, no a las casillas del catálogo.");
    }
    if (!file?.buffer?.length) throw new BadRequestException("Selecciona un archivo.");
    const isVideo = slotRaw === "video" || slotRaw === "9";
    if (isVideo) {
      if (file.size > MAX_INSPECTION_VIDEO_BYTES) {
        throw new BadRequestException("El video supera el máximo de 40 MB.");
      }
      let mime: string;
      try {
        mime = sniffInspectionVideoMime(file.buffer);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const ext = extForInspectionMime(mime);
      const processed = await stripVideoAudio(file.buffer, ext);
      if (!processed.stripped) {
        throw new BadRequestException("No se pudo quitar el audio del video. Sube un MP4 válido.");
      }
      const storageKey = `warehouse/${c.iso}/video360.mp4`;
      await this.storage.put(storageKey, processed.buffer, processed.mime);
      await this.prisma.container.update({
        where: { iso: c.iso },
        data: {
          video360Key: storageKey,
          video360Mime: processed.mime,
        },
      });
      await this.audit.log({
        user,
        action: "upload",
        entity: "InspectionVideo",
        entityId: c.iso,
        after: { storageKey, mime },
        ip,
      });
      return this.presentFor(c.iso, user);
    }
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    await this.storeInspectionPhoto(c, slot, file.buffer, file.originalname, file.size, user, ip, "Reemplazada por una foto nueva");
    return this.presentFor(c.iso, user);
  }

  async listOdooPhotos(iso: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) return [];
    return listOrCacheOdooPhotos(this.prisma, this.storage, this.odoo, {
      odooLotId: c.odooLotId,
      containerIso: c.iso,
    });
  }

  async listOdooNotes(iso: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) return [];
    await this.scrubZdryRefNotes(c.odooLotId);
    const notes = await listOdooLotNotes(this.odoo, c.odooLotId);
    await this.expediente.importOdooNotes(c.iso, notes, { containerIso: c.iso });
    return notes;
  }

  async openOdooPhoto(iso: string, attId: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) throw new NotFoundException("Esta unidad no tiene lote Odoo.");
    return openOrCacheOdooPhoto(this.prisma, this.storage, this.odoo, {
      odooLotId: c.odooLotId,
      containerIso: c.iso,
    }, attId);
  }

  async assignOdooPhoto(iso: string, attId: string, slotRaw: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    if (c.intakeOrigin !== "odoo" || !c.odooLotId) {
      throw new BadRequestException("Solo las unidades asimiladas de Odoo tienen fotos de chatter.");
    }
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    const obj = await openOrCacheOdooPhoto(this.prisma, this.storage, this.odoo, {
      odooLotId: c.odooLotId,
      containerIso: c.iso,
    }, attId);
    await this.storeInspectionPhoto(
      c,
      slot,
      obj.buffer,
      obj.name,
      obj.buffer.length,
      user,
      ip,
      "Reemplazada por foto de Odoo",
      "odoo",
    );
    return this.presentFor(c.iso, user);
  }

  async setOdooRef(iso: string, slotRaw: string | number, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) {
      throw new BadRequestException("Esta unidad no está amarrada a un lote Odoo.");
    }
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    const photo = c.photos.find((p) => p.slot === slot && p.status === PHOTO_STATUS_ACTIVE);
    const gate = canPublishOdooRef(photo);
    if (!gate.ok) throw new BadRequestException(gate.message);
    const raw = await this.storage.getBuffer(photo!.storageKey);
    const jpeg = await toOdooRefJpeg(raw.buffer);
    const existing = await this.odoo.searchRead(
      "ir.attachment",
      zdryRefSearchDomain(c.odooLotId, c.iso),
      ["id", "name", "description"],
      { limit: 20 },
    );
    const created = await this.odoo.create(
      "ir.attachment",
      {
        name: zdryRefAttachmentName(c.iso),
        description: ZDRY_REF_DESC,
        res_model: "stock.lot",
        res_id: c.odooLotId,
        type: "binary",
        mimetype: "image/jpeg",
        datas: jpeg.toString("base64"),
      },
      { context: { ...ZDRY_SYNC_CONTEXT } },
    );
    const newId = Number(created);
    if (!newId) throw new BadRequestException("Odoo no devolvió el adjunto de referencia.");
    const stored = await this.odoo.read("ir.attachment", [newId], ["file_size", "mimetype", "name"]);
    if (!Number(stored?.[0]?.file_size)) {
      throw new BadRequestException("Odoo guardó el adjunto vacío. Revisa permisos de ir.attachment del usuario API.");
    }
    const label = PHOTO_LABELS[slot] || `Casilla ${slot + 1}`;
    await this.odoo.callKw(
      "stock.lot",
      "message_post",
      [[c.odooLotId]],
      {
        ...zdryRefMessagePostKw(zdryRefMessageBody(c.iso, slot, label), newId),
        context: { ...ZDRY_SYNC_CONTEXT },
      },
    );
    const stale = pickZdryRefIdsToUnlink(
      existing.map((a) => ({ id: Number(a.id), name: String(a.name || ""), description: String(a.description || "") })),
      newId,
    );
    if (stale.length) {
      await this.odoo.unlink("ir.attachment", stale, { context: { ...ZDRY_SYNC_CONTEXT } });
    }
    await this.scrubZdryRefNotes(c.odooLotId);
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { odooRefAttachmentId: newId, odooRefSlot: slot, odooRefPushedAt: new Date() },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "OdooRefPhoto",
      entityId: c.iso,
      after: { slot, odooRefAttachmentId: newId, unlinked: stale },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  private async scrubZdryRefNotes(lotId: number) {
    const rows = await this.odoo.searchRead(
      "mail.message",
      [
        ["model", "=", "stock.lot"],
        ["res_id", "=", lotId],
      ],
      ["id", "body"],
      { limit: 40, order: "id desc" },
    );
    for (const row of rows) {
      const raw = String(row.body || "");
      if (!isZdryRefNoteBody(raw) || !/<\/?p|&lt;\/?p/i.test(raw)) continue;
      const plain = plainChatterBody(raw);
      if (!plain) continue;
      await this.odoo.write("mail.message", [Number(row.id)], { body: plain }, { context: { ...ZDRY_SYNC_CONTEXT } });
    }
  }

  async campoQueue(q = "") {
    const live = await this.prisma.liveContainers();
    const needle = q.trim().toUpperCase();
    const [types, categories, rows] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.container.findMany({
        where: {
          ...live,
          status: { not: "Vendido" },
          campoEnabledAt: { not: null },
          ...(needle ? { iso: { contains: needle, mode: "insensitive" } } : {}),
        },
        include: {
          depot: { select: { name: true } },
          photos: { where: { status: PHOTO_STATUS_ACTIVE }, select: { slot: true } },
          _count: { select: { fieldCaptures: true } },
        },
        orderBy: [{ fieldRegularizedAt: "asc" }, { updatedAt: "desc" }],
      }),
    ]);
    const visits = rows.length
      ? await this.prisma.gateVisit.findMany({
          where: { containerIso: { in: rows.map((r) => r.iso) } },
          orderBy: { linkedAt: "desc" },
        })
      : [];
    const visitByIso = new Map<string, (typeof visits)[number]>();
    for (const v of visits) {
      if (v.containerIso && !visitByIso.has(v.containerIso)) visitByIso.set(v.containerIso, v);
    }
    const typeMap = Object.fromEntries(types.map((t) => [t.code, t]));
    const catMap = Object.fromEntries(categories.map((c) => [c.code, c]));
    return rows.map((c) => {
      const visit = visitByIso.get(c.iso);
      return {
        iso: c.iso,
        type: c.type,
        typeLabel: typeMap[c.type]?.label || c.type,
        cat: c.cat,
        catLabel: catMap[c.cat]?.label || c.cat,
        depotName: c.depot.name,
        intakeOrigin: c.intakeOrigin,
        isoException: c.isoException,
        campoEnabledAt: c.campoEnabledAt,
        captureCount: c._count.fieldCaptures,
        photoCount: c.photos.length,
        hasVideo: !!c.video360Key,
        mediaStatus: c.mediaStatus,
        fieldRegularizedAt: c.fieldRegularizedAt,
        fieldRegularizedByName: c.fieldRegularizedByName,
        mediaApprovedAt: c.mediaApprovedAt,
        visit: visit
          ? {
              id: visit.id,
              tractorPlate: visit.tractorPlate,
              driverName: visit.driverName,
              motive: visit.motive,
              company: visit.company,
              photoStatus: visitPhotoStatus(visit),
            }
          : null,
      };
    });
  }

  async regularize(iso: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { fieldRegularizedAt: new Date(), fieldRegularizedByName: user.name },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Campo",
        detail: `Regularización de campo enviada a evaluación por ${user.name}.`,
      },
    });
    await this.audit.log({
      user,
      action: "field_regularize",
      entity: "Container",
      entityId: c.iso,
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async dailyActivity(ymd?: string) {
    const { date, start, end } = limaDayRange(ymd);
    const live = await this.prisma.liveContainers();
    const [regularized, published] = await Promise.all([
      this.prisma.container.findMany({
        where: { ...live, fieldRegularizedAt: { gte: start, lte: end } },
        select: {
          iso: true,
          fieldRegularizedAt: true,
          fieldRegularizedByName: true,
          mediaStatus: true,
          depot: { select: { name: true } },
        },
        orderBy: { fieldRegularizedAt: "desc" },
      }),
      this.prisma.container.findMany({
        where: { ...live, mediaStatus: "aprobado", mediaApprovedAt: { gte: start, lte: end } },
        select: {
          iso: true,
          mediaApprovedAt: true,
          mediaApprovedBy: true,
          depot: { select: { name: true } },
        },
        orderBy: { mediaApprovedAt: "desc" },
      }),
    ]);
    return {
      date,
      regularized: regularized.map((c) => ({
        iso: c.iso,
        at: c.fieldRegularizedAt,
        by: c.fieldRegularizedByName,
        depotName: c.depot.name,
        mediaStatus: c.mediaStatus,
      })),
      published: published.map((c) => ({
        iso: c.iso,
        at: c.mediaApprovedAt,
        depotName: c.depot.name,
      })),
    };
  }

  async archivePhoto(
    photo: { id: string; iso: string; storageKey: string; mimeType: string },
    user: AuthUser,
    note: string,
  ) {
    const ext = photo.storageKey.split(".").pop() || "bin";
    const histKey = `warehouse/${photo.iso}/history/${photo.id}.${ext}`;
    let key = photo.storageKey;
    if (photo.storageKey !== histKey) {
      try {
        const buf = await this.storage.getBuffer(photo.storageKey);
        await this.storage.put(histKey, buf.buffer, photo.mimeType || buf.contentType || "application/octet-stream");
        key = histKey;
      } catch {
        key = photo.storageKey;
      }
    }
    await this.prisma.inspectionPhoto.update({
      where: { id: photo.id },
      data: {
        status: PHOTO_STATUS_REJECTED,
        rejectedAt: new Date(),
        rejectedById: user.id,
        rejectedByName: user.name,
        rejectNote: note,
        storageKey: key,
      },
    });
  }

  async openPhoto(iso: string, slotRaw: string) {
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: { photos: ACTIVE_PHOTOS },
    });
    if (!c) throw new NotFoundException("Contenedor no encontrado.");
    if (slotRaw === "video" || slotRaw === "9") {
      if (!c.video360Key) throw new NotFoundException("Sin video 360.");
      const obj = await this.storage.get(c.video360Key);
      return { ...obj, contentType: c.video360Mime || obj.contentType };
    }
    const slot = Number(slotRaw);
    const photo = c.photos.find((p) => p.slot === slot);
    if (!photo) throw new NotFoundException("Sin foto en ese slot.");
    const obj = await this.storage.get(photo.storageKey);
    return { ...obj, contentType: photo.mimeType || obj.contentType };
  }

  async openStoredPhoto(storageKey: string, mimeType?: string) {
    const obj = await this.storage.get(storageKey);
    return { ...obj, contentType: mimeType || obj.contentType };
  }

  async archive(iso: string, input: { kind?: string; comment?: string }, user: AuthUser, ip?: string) {
    const why = archiveMotive(input.kind, input.comment);
    const c = await this.loadUnit(iso);
    if (c.archivedAt) throw new BadRequestException("Esta unidad ya está archivada.");
    if (c.status === "Vendido") throw new BadRequestException("No se puede archivar una unidad vendida.");
    const updated = await this.prisma.container.update({
      where: { iso: c.iso },
      data: {
        archivedAt: new Date(),
        archiveReason: why,
        archivedById: user.id,
        archivedByName: user.name,
        lado: null,
        ruma: null,
        columna: null,
        nivel: null,
        mediaStatus: c.mediaStatus === "aprobado" ? "oculto" : c.mediaStatus,
      },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Archivo",
        detail: `Unidad archivada por ${user.name}: ${why}`,
      },
    });
    await this.audit.log({
      user,
      action: "archive",
      entity: "Container",
      entityId: c.iso,
      after: { reason: why },
      ip,
    });
    return {
      iso: updated.iso,
      archivedAt: updated.archivedAt,
      archiveReason: updated.archiveReason,
      archivedByName: updated.archivedByName,
    };
  }

  async unarchive(iso: string, user: AuthUser, ip?: string) {
    if (!isSuperadmin(user.role)) throw new ForbiddenException("Solo el superusuario desarchiva.");
    const c = await this.loadUnit(iso, true);
    if (!c.archivedAt) throw new BadRequestException("Esta unidad no está archivada.");
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { archivedAt: null, archiveReason: null, archivedById: null, archivedByName: null },
    });
    await this.prisma.containerHistory.create({
      data: { iso: c.iso, type: "Archivo", detail: `Unidad desarchivada por ${user.name}.` },
    });
    await this.audit.log({ user, action: "unarchive", entity: "Container", entityId: c.iso, ip });
    return this.presentFor(c.iso, user);
  }

  async confirm(iso: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    const missing = c.intakeOrigin === "odoo" ? [] : inspectDataMissing(c);
    if (missing.length) {
      throw new UnprocessableEntityException("Completa año y fabricante antes de continuar.");
    }
    const nextStatus = c.status === "Pendiente de ingreso" ? "Disponible" : c.status;
    const updated = await this.prisma.container.update({
      where: { iso: c.iso },
      data: {
        physicallyReceived: true,
        status: nextStatus,
        mediaStatus: c.mediaStatus === "aprobado" ? c.mediaStatus : "pendiente",
      },
      include: { depot: true },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Recepción física",
        detail: `Recepción e inspección confirmadas en un solo paso en Almacén — ${updated.depot.name}. Año: ${c.year}, fabricante: ${c.manufacturer}, color: ${c.color}.`,
      },
    });
    await this.audit.log({
      user,
      action: "confirm",
      entity: "Container",
      entityId: c.iso,
      after: { physicallyReceived: true, status: nextStatus },
      ip,
    });
    return {
      ok: true,
      iso: c.iso,
      depotId: c.depotId,
      message: `✓ ${c.iso} confirmado — ahora está en la lista de "sin posición asignada" del Layout.`,
    };
  }

  async toggleGate(iso: string, field: string, user: AuthUser, ip?: string) {
    if (field !== "gateIn" && field !== "gateOut") {
      throw new BadRequestException("Campo de gate inválido.");
    }
    const c = await this.loadUnit(iso);
    const next = !c[field];
    await this.prisma.container.update({ where: { iso: c.iso }, data: { [field]: next } });
    const label = field === "gateIn" ? "Gate-In" : "Gate-Out";
    if (next) {
      await this.prisma.containerHistory.create({
        data: {
          iso: c.iso,
          type: label,
          detail: `${label} registrado en patio (el cargo de servicio se aplica en Sprint 8).`,
        },
      });
    }
    await this.audit.log({
      user,
      action: "update",
      entity: "Container",
      entityId: c.iso,
      after: { [field]: next },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async registerService(iso: string, key: string, user: AuthUser, ip?: string) {
    return this.registerActivity(iso, { conceptKey: key, note: "" }, user, ip);
  }

  async migrateDepot(iso: string, depotId: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") {
      throw new ForbiddenException("Solo el coordinador o el administrador migran el almacén.");
    }
    const c = await this.loadUnit(iso);
    const depot = await this.prisma.depot.findUnique({ where: { id: depotId || "" } });
    if (!depot || depot.archivedAt) throw new BadRequestException("Elige un almacén disponible.");
    if (depot.id === c.depotId) throw new BadRequestException("La unidad ya está en ese almacén.");
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { depotId: depot.id, lado: null, ruma: null, columna: null, nivel: null, bayHalf: null },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Almacén",
        detail: `Almacén migrado de ${c.depot.name} a ${depot.name} por ${user.name}. La posición de patio queda libre.`,
      },
    });
    await this.audit.log({
      user,
      action: "migrate_depot",
      entity: "Container",
      entityId: c.iso,
      before: { depotId: c.depotId, depotName: c.depot.name },
      after: { depotId: depot.id, depotName: depot.name },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async changeType(iso: string, typeCode: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") {
      throw new ForbiddenException("Solo el coordinador o el administrador cambian el tipo.");
    }
    const c = await this.loadUnit(iso);
    const typeRow = await this.prisma.containerType.findUnique({ where: { code: typeCode || "" } });
    if (!typeRow || typeRow.archivedAt) throw new BadRequestException("Elige un tipo disponible.");
    if (typeRow.code === c.type) throw new BadRequestException("La unidad ya es de ese tipo.");
    await this.prisma.container.update({ where: { iso: c.iso }, data: { type: typeRow.code } });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Tipo",
        detail: `Tipo cambiado de ${c.type} a ${typeRow.code} por ${user.name}. No cambia el producto en Odoo.`,
      },
    });
    await this.audit.log({
      user,
      action: "change_type",
      entity: "Container",
      entityId: c.iso,
      before: { type: c.type },
      after: { type: typeRow.code },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async enableCampo(iso: string, user: AuthUser, ip?: string, depotId?: string) {
    if (user.role === "almacen") {
      throw new ForbiddenException("Solo el coordinador o el administrador envían unidades a campo.");
    }
    return this.applyCampoEnable(iso, user, ip, false, depotId);
  }

  private async applyCampoEnable(iso: string, user: AuthUser, ip?: string, emergency = false, depotId?: string) {
    const c = await this.loadUnit(iso);
    if (c.campoEnabledAt) return this.presentFor(c.iso, user);
    await ensureOperationalDepots(this.prisma);
    const warehouse = c.odooWarehouse || warehouseFromLocation(c.odooLocation);
    let nextDepotId = c.depotId;
    if (depotId) {
      const chosen = await this.prisma.depot.findUnique({ where: { id: depotId } });
      if (!chosen || chosen.archivedAt) throw new BadRequestException("Elige un almacén disponible.");
      nextDepotId = chosen.id;
    } else if (needsPatioChoice(warehouse, c.depot.code)) {
      throw new BadRequestException("Elige el almacén antes de enviar a campo.");
    }
    const nextStatus = c.status === "Pendiente de ingreso" ? "Disponible" : c.status;
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: {
        depotId: nextDepotId,
        campoEnabledAt: new Date(),
        campoEnabledByName: user.name,
        physicallyReceived: true,
        physicalStatus: "en_patio",
        status: nextStatus,
      },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: emergency ? "Emergencia" : "Campo",
        detail: emergency
          ? `Registro de emergencia en campo por ${user.name}.`
          : `Habilitada para personal de campo por ${user.name}. Año y fotos no son requisito.`,
      },
    });
    await this.audit.log({
      user,
      action: emergency ? "emergency_campo" : "enable_campo",
      entity: "Container",
      entityId: c.iso,
      after: { campoEnabledAt: true, emergency, depotId: nextDepotId },
      ip,
    });
    await this.applyGateInOnce(c.iso, user);
    return this.presentFor(c.iso, user);
  }

  async addCatalogOption(kind: "color" | "manufacturer" | "document", raw: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") throw new ForbiddenException("Sin acceso.");
    const label = kind === "document" ? normalizeDocumentConcept(raw) : normalizeOptionLabel(raw);
    if (label.length < 2) throw new BadRequestException("El valor es demasiado corto.");
    const key = kind === "color" ? COLORS_KEY : kind === "manufacturer" ? MANUFACTURERS_KEY : DOCUMENTS_KEY;
    const defaults = kind === "color" ? CONTAINER_COLORS : kind === "manufacturer" ? MANUFACTURERS : DEFAULT_DOCUMENT_CONCEPTS;
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const merged = mergeCatalogOptions(defaults, row?.value);
    const next = mergeCatalogOptions(merged, [label]);
    await this.prisma.appSetting.upsert({
      where: { key },
      update: { value: next.filter((x) => !defaults.includes(x)) },
      create: { key, value: next.filter((x) => !defaults.includes(x)) },
    });
    await this.audit.log({
      user,
      action: "create",
      entity: kind === "color" ? "ContainerColor" : kind === "manufacturer" ? "Manufacturer" : "DocumentConcept",
      entityId: label,
      after: { label },
      ip,
    });
    return this.meta(user);
  }

  async uploadCapture(
    iso: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    note: string,
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.loadUnit(iso);
    if (!c.campoEnabledAt && user.role === "almacen") {
      throw new BadRequestException("Esta unidad aún no está habilitada para campo.");
    }
    if (!file?.buffer?.length) throw new BadRequestException("Selecciona un archivo.");
    let kind: "photo" | "video" = "photo";
    let mime: string;
    try {
      mime = sniffInspectionPhotoMime(file.buffer);
    } catch {
      try {
        mime = sniffInspectionVideoMime(file.buffer);
        kind = "video";
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }
    if (kind === "photo" && file.size > MAX_INSPECTION_PHOTO_BYTES) {
      throw new BadRequestException("La foto supera el máximo de 8 MB.");
    }
    if (kind === "video" && file.size > MAX_INSPECTION_VIDEO_BYTES) {
      throw new BadRequestException("El video supera el máximo de 40 MB.");
    }
    const ext = extForInspectionMime(mime);
    const id = randomUUID();
    let payload = file.buffer;
    let storedMime = mime;
    let storedExt = ext;
    let storedSize = file.size;
    if (kind === "video") {
      const processed = await stripVideoAudio(file.buffer, ext);
      if (!processed.stripped) {
        throw new BadRequestException("No se pudo quitar el audio del video. Sube un MP4 válido.");
      }
      payload = processed.buffer;
      storedMime = processed.mime;
      storedExt = "mp4";
      storedSize = processed.buffer.length;
    }
    const storageKey = `warehouse/${c.iso}/captures/${id}.${storedExt}`;
    await this.storage.put(storageKey, payload, storedMime);
    const row = await this.prisma.fieldCapture.create({
      data: {
        iso: c.iso,
        kind,
        storageKey,
        mimeType: storedMime,
        originalName: file.originalname || `${kind}.${storedExt}`,
        sizeBytes: storedSize,
        note: String(note || "").trim(),
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await this.audit.log({
      user,
      action: "upload",
      entity: "FieldCapture",
      entityId: row.id,
      after: { iso: c.iso, kind },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async openCapture(iso: string, id: string, user?: AuthUser) {
    const row = await this.prisma.fieldCapture.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Toma no encontrada.");
    if (row.archivedAt && user?.role !== "superadmin") {
      throw new ForbiddenException("Solo el superusuario ve las tomas archivadas.");
    }
    const obj = await this.storage.get(row.storageKey);
    return { ...obj, contentType: row.mimeType || obj.contentType, name: row.originalName };
  }

  async openPhotoHistory(iso: string, id: string) {
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id, iso, status: PHOTO_STATUS_REJECTED },
    });
    if (!photo) throw new NotFoundException("Foto archivada no encontrada.");
    const obj = await this.storage.get(photo.storageKey);
    return { ...obj, contentType: photo.mimeType || obj.contentType };
  }

  async archiveCapture(iso: string, id: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no archiva tomas.");
    const c = await this.loadUnit(iso);
    const cap = await this.prisma.fieldCapture.findFirst({ where: { id, iso: c.iso, archivedAt: null } });
    if (!cap) throw new NotFoundException("Toma no encontrada.");
    await this.prisma.fieldCapture.update({
      where: { id: cap.id },
      data: { archivedAt: new Date(), archivedById: user.id, archivedByName: user.name },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Foto",
        detail: `${user.name} archivó una toma de campo${cap.originalName ? ` (${cap.originalName})` : ""}.`,
      },
    });
    await this.audit.log({
      user,
      action: "archive_capture",
      entity: "FieldCapture",
      entityId: cap.id,
      after: { iso: c.iso },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async restoreCapture(iso: string, id: string, user: AuthUser, ip?: string) {
    if (!isSuperadmin(user.role)) throw new ForbiddenException("Solo el superusuario desarchiva imágenes.");
    const c = await this.loadUnit(iso, true);
    const cap = await this.prisma.fieldCapture.findFirst({ where: { id, iso: c.iso, archivedAt: { not: null } } });
    if (!cap) throw new NotFoundException("Toma archivada no encontrada.");
    await this.prisma.fieldCapture.update({
      where: { id: cap.id },
      data: { archivedAt: null, archivedById: null, archivedByName: null, assignedSlot: null },
    });
    await this.prisma.containerHistory.create({
      data: { iso: c.iso, type: "Foto", detail: `${user.name} desarchivó una toma de campo.` },
    });
    await this.audit.log({ user, action: "restore_capture", entity: "FieldCapture", entityId: cap.id, after: { iso: c.iso }, ip });
    return this.presentFor(c.iso, user);
  }

  async restoreArchivedPhoto(iso: string, id: string, user: AuthUser, ip?: string) {
    if (!isSuperadmin(user.role)) throw new ForbiddenException("Solo el superusuario desarchiva imágenes.");
    const c = await this.loadUnit(iso, true);
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id, iso: c.iso, status: PHOTO_STATUS_REJECTED },
    });
    if (!photo) throw new NotFoundException("Foto archivada no encontrada.");
    const occupied = await this.prisma.inspectionPhoto.findFirst({
      where: { iso: c.iso, slot: photo.slot, status: PHOTO_STATUS_ACTIVE },
    });
    if (occupied) {
      throw new BadRequestException(`La casilla ${photo.slot + 1} ya tiene una foto. Quítala antes de desarchivar esta.`);
    }
    await this.prisma.inspectionPhoto.update({
      where: { id: photo.id },
      data: { status: PHOTO_STATUS_ACTIVE, rejectedAt: null, rejectedById: null, rejectedByName: null, rejectNote: null },
    });
    await this.prisma.containerHistory.create({
      data: { iso: c.iso, type: "Foto", detail: `${user.name} desarchivó la foto de la casilla ${photo.slot + 1}.` },
    });
    await this.audit.log({ user, action: "restore_photo", entity: "InspectionPhoto", entityId: photo.id, after: { iso: c.iso, slot: photo.slot }, ip });
    return this.presentFor(c.iso, user);
  }

  async clearSlot(iso: string, slotRaw: string, to: "campo" | "archive", user: AuthUser, ip?: string) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no quita casillas del catálogo.");
    const c = await this.loadUnit(iso);
    const isVideo = slotRaw === "video" || slotRaw === "9";
    const slot = isVideo ? 9 : Number(slotRaw);
    if (!isVideo && (!Number.isInteger(slot) || slot < 0 || slot > 8)) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    const photo = isVideo ? null : c.photos.find((p) => p.slot === slot && p.status === PHOTO_STATUS_ACTIVE);
    if (isVideo ? !c.video360Key : !photo) throw new BadRequestException("Esa casilla está vacía.");
    const linked = await this.prisma.fieldCapture.findFirst({
      where: { iso: c.iso, assignedSlot: slot, archivedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (to === "campo") {
      if (linked) {
        await this.prisma.fieldCapture.update({ where: { id: linked.id }, data: { assignedSlot: null } });
      } else if (isVideo && c.video360Key) {
        await this.captureFromStored(c.iso, c.video360Key, c.video360Mime || "video/mp4", "video", "Video 360", user, false);
      } else if (photo) {
        await this.captureFromStored(c.iso, photo.storageKey, photo.mimeType, "photo", photo.originalName, user, false);
      }
    } else if (linked) {
      await this.prisma.fieldCapture.update({
        where: { id: linked.id },
        data: { archivedAt: new Date(), archivedById: user.id, archivedByName: user.name },
      });
    } else if (isVideo && c.video360Key) {
      await this.captureFromStored(c.iso, c.video360Key, c.video360Mime || "video/mp4", "video", "Video 360", user, true);
    }
    if (isVideo) {
      await this.prisma.container.update({
        where: { iso: c.iso },
        data: { video360Key: null, video360Mime: null },
      });
    } else if (photo) {
      await this.archivePhoto(photo, user, to === "campo" ? "Devuelta a tomas de campo" : "Quitada de la casilla");
      if (c.odooRefSlot === slot) {
        await this.prisma.container.update({
          where: { iso: c.iso },
          data: { odooRefSlot: null, odooRefAttachmentId: null, odooRefPushedAt: null },
        });
      }
    }
    const label = isVideo ? "Video 360" : PHOTO_LABELS[slot] || `Casilla ${slot + 1}`;
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Foto",
        detail: to === "campo"
          ? `${user.name} sacó ${label} de la casilla y la devolvió a tomas de campo.`
          : `${user.name} quitó ${label} de la casilla. Quedó archivada.`,
      },
    });
    await this.audit.log({
      user,
      action: "clear_slot",
      entity: "InspectionPhoto",
      entityId: c.iso,
      after: { slot, to },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  private async captureFromStored(
    iso: string,
    storageKey: string,
    mimeType: string,
    kind: "photo" | "video",
    originalName: string,
    user: AuthUser,
    archived: boolean,
  ) {
    const buf = await this.storage.getBuffer(storageKey);
    const ext = storageKey.split(".").pop() || (kind === "video" ? "mp4" : "jpg");
    const id = randomUUID();
    const nextKey = `warehouse/${iso}/captures/${id}.${ext}`;
    await this.storage.put(nextKey, buf.buffer, mimeType || buf.contentType || "application/octet-stream");
    await this.prisma.fieldCapture.create({
      data: {
        iso,
        kind,
        storageKey: nextKey,
        mimeType: mimeType || buf.contentType || "application/octet-stream",
        originalName: originalName || `${kind}.${ext}`,
        sizeBytes: buf.buffer.length,
        note: "",
        createdById: user.id,
        createdByName: user.name,
        archivedAt: archived ? new Date() : null,
        archivedById: archived ? user.id : null,
        archivedByName: archived ? user.name : null,
      },
    });
  }

  async assignCapture(iso: string, id: string, slotRaw: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") {
      throw new ForbiddenException("El personal de campo no asigna casillas de catálogo.");
    }
    const c = await this.loadUnit(iso);
    const cap = await this.prisma.fieldCapture.findFirst({ where: { id, iso: c.iso } });
    if (!cap) throw new NotFoundException("Toma no encontrada.");
    const buf = await this.storage.getBuffer(cap.storageKey);
    const isVideo = slotRaw === "video" || slotRaw === "9" || cap.kind === "video";
    let portrait = false;
    if (isVideo) {
      await this.uploadMedia(c.iso, "video", { buffer: buf.buffer, originalname: cap.originalName, size: buf.buffer.length }, user, ip);
      await this.prisma.fieldCapture.updateMany({
        where: { iso: c.iso, assignedSlot: 9, archivedAt: null, id: { not: cap.id } },
        data: { assignedSlot: null },
      });
      await this.prisma.fieldCapture.update({ where: { id: cap.id }, data: { assignedSlot: 9 } });
    } else {
      const slot = Number(slotRaw);
      if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
        throw new BadRequestException("Slot de foto inválido (0–8).");
      }
      try {
        const Jimp = (await import("jimp")).default;
        const img = await Jimp.read(buf.buffer);
        portrait = img.getHeight() > img.getWidth();
      } catch {
        portrait = false;
      }
      await this.storeInspectionPhoto(c, slot, buf.buffer, cap.originalName, buf.buffer.length, user, ip, "Asignada desde toma de campo");
      await this.prisma.fieldCapture.updateMany({
        where: { iso: c.iso, assignedSlot: slot, archivedAt: null, id: { not: cap.id } },
        data: { assignedSlot: null },
      });
      await this.prisma.fieldCapture.update({ where: { id: cap.id }, data: { assignedSlot: slot } });
    }
    await this.audit.log({
      user,
      action: "assign_capture",
      entity: "FieldCapture",
      entityId: cap.id,
      after: { iso: c.iso, slot: slotRaw },
      ip,
    });
    const unit = await this.presentFor(c.iso, user);
    return { ...unit, assignWarning: portrait ? "Esta toma es vertical: al publicar quedará con bandas a los lados." : null };
  }

  async registerActivity(
    iso: string,
    input: { conceptKey?: string; conceptId?: string; note?: string },
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no registra costos.");
    const c = await this.loadUnit(iso);
    const concept = input.conceptId
      ? await this.prisma.depotCostConcept.findUnique({ where: { id: input.conceptId } })
      : await this.prisma.depotCostConcept.findUnique({ where: { key: input.conceptKey || "" } });
    if (!concept || !concept.active) throw new BadRequestException("Concepto de patio inválido.");
    if (concept.key === GATE_IN_KEY) {
      const existing = await this.prisma.depotCostEntry.findMany({
        where: { iso: c.iso, conceptKey: GATE_IN_KEY },
        select: { conceptKey: true },
      });
      if (!canApplyGateIn(existing.map((e) => e.conceptKey))) {
        throw new BadRequestException("Gate-In ya está aplicado en esta unidad.");
      }
    }
    const hide = hideRatesFor(user.role);
    const entry = await this.prisma.depotCostEntry.create({
      data: {
        iso: c.iso,
        conceptId: concept.id,
        conceptKey: concept.key,
        conceptLabel: concept.label,
        amount: concept.amount,
        note: String(input.note || "").trim(),
        auto: false,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: concept.label,
        detail: hide
          ? `${concept.label} registrado por ${user.name}${entry.note ? ` — ${entry.note}` : ""}.`
          : `${concept.label} registrado ($${Number(concept.amount)})${entry.note ? ` — ${entry.note}` : ""}.`,
      },
    });
    await this.audit.log({
      user,
      action: "depot_cost",
      entity: "DepotCostEntry",
      entityId: entry.id,
      after: { iso: c.iso, conceptKey: concept.key },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async uploadDocument(
    iso: string,
    file: { buffer: Buffer; originalname: string; size: number; mimetype?: string } | undefined,
    concept: string,
    note: string,
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no adjunta documentos de unidad.");
    const c = await this.loadUnit(iso);
    if (!file?.buffer?.length) throw new BadRequestException("Selecciona un archivo.");
    const conceptLabel = normalizeDocumentConcept(concept);
    if (conceptLabel.length < 2) throw new BadRequestException("Indica el concepto del documento.");
    await this.rememberDocumentConcept(conceptLabel);
    const mime = file.mimetype || "application/octet-stream";
    if (!/^image\//.test(mime) && mime !== "application/pdf") {
      throw new BadRequestException("Solo se aceptan PDF o imágenes.");
    }
    const id = randomUUID();
    const ext = mime === "application/pdf" ? "pdf" : extForInspectionMime(mime) || "bin";
    const storageKey = `warehouse/${c.iso}/docs/${id}.${ext}`;
    await this.storage.put(storageKey, file.buffer, mime);
    const row = await this.prisma.containerDocument.create({
      data: {
        iso: c.iso,
        concept: conceptLabel,
        note: String(note || "").trim(),
        originalName: file.originalname || `documento.${ext}`,
        mimeType: mime,
        sizeBytes: file.size,
        storageKey,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await this.audit.log({
      user,
      action: "upload",
      entity: "ContainerDocument",
      entityId: row.id,
      after: { iso: c.iso, concept: conceptLabel },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async updateDocument(
    iso: string,
    id: string,
    input: { concept?: string; note?: string },
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no edita documentos de unidad.");
    await this.loadUnit(iso);
    const row = await this.prisma.containerDocument.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Documento no encontrado.");
    const data: { concept?: string; note?: string } = {};
    if (input.concept !== undefined) {
      const conceptLabel = normalizeDocumentConcept(input.concept);
      if (conceptLabel.length < 2) throw new BadRequestException("Indica el concepto del documento.");
      await this.rememberDocumentConcept(conceptLabel);
      data.concept = conceptLabel;
    }
    if (input.note !== undefined) data.note = String(input.note || "").trim();
    await this.prisma.containerDocument.update({ where: { id }, data });
    await this.audit.log({
      user,
      action: "update",
      entity: "ContainerDocument",
      entityId: id,
      after: { iso, ...data },
      ip,
    });
    return this.presentFor(iso, user);
  }

  async deleteDocument(iso: string, id: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no elimina documentos de unidad.");
    await this.loadUnit(iso);
    const row = await this.prisma.containerDocument.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Documento no encontrado.");
    await this.storage.delete(row.storageKey).catch(() => undefined);
    await this.prisma.containerDocument.delete({ where: { id } });
    await this.audit.log({
      user,
      action: "delete",
      entity: "ContainerDocument",
      entityId: id,
      after: { iso, concept: row.concept },
      ip,
    });
    return this.presentFor(iso, user);
  }

  async emergencyIntake(
    input: { iso?: string; depotId?: string; type?: string; cat?: string; note?: string },
    user: AuthUser,
    ip?: string,
  ) {
    const inspected = inspectIntakeIso(input.iso || "");
    if (!inspected.ok) throw new BadRequestException(inspected.message);
    const iso = inspected.isoNormalized;
    const existing = await this.prisma.container.findUnique({ where: { iso } });
    if (existing?.archivedAt) throw new BadRequestException("Esta unidad está archivada.");
    if (existing) {
      return this.applyCampoEnable(existing.iso, user, ip, true);
    }
    const depot =
      (input.depotId
        ? await this.prisma.depot.findUnique({ where: { id: input.depotId } })
        : await this.prisma.depot.findFirst({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }));
    if (!depot || depot.archivedAt) throw new BadRequestException("No hay depósito disponible para el registro de emergencia.");
    const typeRow =
      (input.type ? await this.prisma.containerType.findUnique({ where: { code: input.type } }) : null) ||
      (await this.prisma.containerType.findFirst({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }));
    const catRow =
      (input.cat ? await this.prisma.category.findUnique({ where: { code: input.cat } }) : null) ||
      (await this.prisma.category.findFirst({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }));
    if (!typeRow || typeRow.archivedAt) throw new BadRequestException("Tipo inválido.");
    if (!catRow || catRow.archivedAt) throw new BadRequestException("Condición inválida.");
    await this.prisma.$transaction(async (tx) => {
      await tx.container.create({
        data: {
          iso,
          type: typeRow.code,
          cat: catRow.code,
          status: "Pendiente de ingreso",
          year: null,
          manufacturer: "—",
          depotId: depot.id,
          intakeType: "pendiente_factura",
          intakeOrigin: "emergencia",
          invoicePending: true,
          physicallyReceived: false,
          isoException: inspected.isoException,
          isoExceptionReason: inspected.isoExceptionReason,
          fobCif: 0,
          cbm: defaultCbm(typeRow.code),
          inspectionNotes: String(input.note || "").trim(),
          registeredById: user.id,
          registeredByName: user.name,
        },
      });
      await tx.containerHistory.create({
        data: {
          iso,
          type: "Emergencia",
          detail: `Registro de emergencia en campo por ${user.name}${input.note ? ` — ${input.note}` : ""}.`,
        },
      });
    });
    await this.audit.log({
      user,
      action: "emergency_intake",
      entity: "Container",
      entityId: iso,
      after: { iso, intakeOrigin: "emergencia" },
      ip,
    });
    return this.applyCampoEnable(iso, user, ip, true);
  }

  async openDocument(iso: string, id: string) {
    const row = await this.prisma.containerDocument.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Documento no encontrado.");
    const obj = await this.storage.get(row.storageKey);
    return { ...obj, contentType: row.mimeType || obj.contentType, name: row.originalName };
  }

  private async applyGateInOnce(iso: string, user: AuthUser) {
    const existing = await this.prisma.depotCostEntry.findMany({
      where: { iso, conceptKey: GATE_IN_KEY },
      select: { conceptKey: true },
    });
    if (!canApplyGateIn(existing.map((e) => e.conceptKey))) return;
    const concept = await this.prisma.depotCostConcept.findUnique({ where: { key: GATE_IN_KEY } });
    if (!concept) return;
    await this.prisma.depotCostEntry.create({
      data: {
        iso,
        conceptId: concept.id,
        conceptKey: concept.key,
        conceptLabel: concept.label,
        amount: concept.amount,
        note: "Gate-In automático al habilitar para campo",
        auto: true,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await this.prisma.container.update({ where: { iso }, data: { gateIn: true } });
    await this.prisma.containerHistory.create({
      data: {
        iso,
        type: "Gate-In",
        detail: `Gate-In aplicado automáticamente al enviar a campo.`,
      },
    });
  }

  private async rememberDocumentConcept(label: string) {
    if (DEFAULT_DOCUMENT_CONCEPTS.some((d) => d.toLowerCase() === label.toLowerCase())) return;
    const row = await this.prisma.appSetting.findUnique({ where: { key: DOCUMENTS_KEY } });
    const next = mergeCatalogOptions(DEFAULT_DOCUMENT_CONCEPTS, [...(Array.isArray(row?.value) ? row.value : []), label]);
    await this.prisma.appSetting.upsert({
      where: { key: DOCUMENTS_KEY },
      update: { value: next.filter((x) => !DEFAULT_DOCUMENT_CONCEPTS.includes(x)) },
      create: { key: DOCUMENTS_KEY, value: next.filter((x) => !DEFAULT_DOCUMENT_CONCEPTS.includes(x)) },
    });
  }

  private documentLabel(concept: string) {
    return normalizeDocumentConcept(concept);
  }

  private async loadUnitExtras(iso: string, hideRates: boolean, includeArchive = false) {
    const [captures, archivedCaptures, archivedPhotos, costs, documents, visit, evalData] = await Promise.all([
      this.prisma.fieldCapture.findMany({ where: { iso, archivedAt: null }, orderBy: { createdAt: "desc" } }),
      includeArchive
        ? this.prisma.fieldCapture.findMany({ where: { iso, archivedAt: { not: null } }, orderBy: { archivedAt: "desc" } })
        : Promise.resolve([]),
      includeArchive
        ? this.prisma.inspectionPhoto.findMany({ where: { iso, status: PHOTO_STATUS_REJECTED }, orderBy: { rejectedAt: "desc" } })
        : Promise.resolve([]),
      this.prisma.depotCostEntry.findMany({ where: { iso }, orderBy: { createdAt: "desc" } }),
      this.prisma.containerDocument.findMany({ where: { iso }, orderBy: { createdAt: "desc" } }),
      this.prisma.gateVisit.findFirst({ where: { containerIso: iso, archivedAt: null }, orderBy: { linkedAt: "desc" } }),
      this.evaluation.forUnit(iso),
    ]);
    return {
      captures: captures.map((r) => ({
        id: r.id,
        kind: r.kind,
        note: r.note,
        assignedSlot: r.assignedSlot,
        originalName: r.originalName,
        createdByName: r.createdByName,
        createdAt: r.createdAt,
      })),
      archivedCaptures: archivedCaptures.map((r) => ({
        id: r.id,
        kind: r.kind,
        note: r.note,
        assignedSlot: r.assignedSlot,
        originalName: r.originalName,
        createdByName: r.createdByName,
        createdAt: r.createdAt,
        archivedAt: r.archivedAt,
        archivedByName: r.archivedByName,
      })),
      archivedPhotos: archivedPhotos.map((p) => ({
        id: p.id,
        slot: p.slot,
        label: PHOTO_LABELS[p.slot] || `Casilla ${p.slot + 1}`,
        originalName: p.originalName,
        rejectedAt: p.rejectedAt,
        rejectedByName: p.rejectedByName,
        rejectNote: p.rejectNote,
      })),
      depotCosts: costs.map((r) => presentDepotCost(r, hideRates)),
      documents: documents.map((r) => ({
        id: r.id,
        concept: this.documentLabel(r.concept),
        conceptLabel: this.documentLabel(r.concept),
        note: r.note,
        originalName: r.originalName,
        mimeType: r.mimeType,
        createdByName: r.createdByName,
        createdAt: r.createdAt,
      })),
      visit: visit
        ? {
            id: visit.id,
            tractorPlate: visit.tractorPlate,
            company: visit.company,
            ruc: visit.ruc,
            driverName: visit.driverName,
            visitAt: visit.visitAt,
            license: visit.license,
            motive: visit.motive,
            trailerPlate: visit.trailerPlate,
            phone: visit.phone,
            equipmentCode: visit.equipmentCode,
            containerIso: visit.containerIso,
            linkedAt: visit.linkedAt,
            linkedByName: visit.linkedByName,
            locked: visit.status !== "REGISTRADO",
            hasPhoto: visitPhotoStatus(visit) === "visible",
            photoArchived: visitPhotoStatus(visit) === "archived",
            photoStatus: visitPhotoStatus(visit),
            photoName: visit.unitPhotoName || null,
            publicToken: visit.publicToken,
          }
        : null,
      ratings: evalData.ratings,
      ratingHistory: evalData.ratingHistory,
    };
  }

  private async loadUnit(iso: string, allowArchived = false): Promise<ContainerRow> {
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: {
        depot: true,
        photos: ACTIVE_PHOTOS,
        ownerCustomer: { select: { id: true, companyName: true, rucDni: true } },
      },
    });
    if (!c) throw new NotFoundException("Contenedor no encontrado.");
    if (c.archivedAt && !allowArchived) throw new BadRequestException("Esta unidad está archivada.");
    return c;
  }

  private assertYardDemo(user: AuthUser) {
    if (user.role !== "superadmin" && user.role !== "admin") {
      throw new ForbiddenException("Solo el administrador y el superadmin usan el depósito demo.");
    }
  }

  private async readYardSim(depotId = YARD_DEMO_ID): Promise<YardSim> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: yardSimKey(depotId) } });
    const value = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Record<string, unknown>) : {};
    const placements = Array.isArray(value.placements)
      ? value.placements.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const raw = item as Record<string, unknown>;
          const iso = String(raw.iso || "").trim().toUpperCase();
          const lado = String(raw.lado || "").trim();
          if (!iso || !lado) return [];
          const num = (key: string) => {
            const n = Number(raw[key]);
            return Number.isInteger(n) && n > 0 ? n : null;
          };
          const aisle = lado === AISLE_SIDE;
          const half: "A" | "B" | null = raw.half === "A" ? "A" : raw.half === "B" ? "B" : null;
          return [{ iso, lado, ruma: aisle ? null : num("ruma"), columna: aisle ? null : num("columna"), nivel: aisle ? null : num("nivel"), half }];
        })
      : [];
    const history = Array.isArray(value.history)
      ? value.history.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const raw = item as Record<string, unknown>;
          const iso = String(raw.iso || "").trim().toUpperCase();
          const detail = String(raw.detail || "");
          if (!iso || !detail) return [];
          return [{
            id: String(raw.id || randomUUID()),
            iso,
            type: String(raw.type || "Movimiento"),
            detail,
            createdAt: String(raw.createdAt || new Date().toISOString()),
          }];
        }).slice(0, 300)
      : [];
    const scenarioId = String(value.scenarioId || "");
    const rumaTemplateId = String(value.rumaTemplateId || "");
    return {
      placements,
      history,
      ...(scenarioId ? { scenarioId } : {}),
      withPerimeter: value.withPerimeter === true,
      ...(rumaTemplateId ? { rumaTemplateId } : {}),
    };
  }

  private async writeYardSim(depotId: string, sim: YardSim) {
    const value = {
      placements: sim.placements,
      history: sim.history.slice(0, 300),
      ...(sim.scenarioId ? { scenarioId: sim.scenarioId } : {}),
      withPerimeter: sim.withPerimeter === true,
      ...(sim.rumaTemplateId ? { rumaTemplateId: sim.rumaTemplateId } : {}),
    };
    await this.prisma.appSetting.upsert({
      where: { key: yardSimKey(depotId) },
      update: { value },
      create: { key: yardSimKey(depotId), value },
    });
  }

  private async yardPositions(depotId: string) {
    if (isYardDemo(depotId)) {
      const sim = await this.readYardSim(depotId);
      const isos = sim.placements.map((item) => item.iso);
      const typed = isos.length
        ? await this.prisma.container.findMany({ where: { iso: { in: isos } }, select: { iso: true, type: true } })
        : [];
      const typeOf = new Map(typed.map((item) => [item.iso, item.type]));
      return sim.placements.map((item) => ({ ...item, type: typeOf.get(item.iso) || "", bayHalf: item.half || null }));
    }
    return this.prisma.container.findMany({
      where: { depotId, archivedAt: null, lado: { not: null } },
      select: { iso: true, type: true, lado: true, ruma: true, columna: true, nivel: true, bayHalf: true },
    });
  }

  private async placeInDemo(depotId: string, iso: string, lado: string, ruma: number, columna: number, nivel: number, half: "A" | "B" | null, stacker: boolean, user: AuthUser, ip?: string) {
    this.assertYardDemo(user);
    return this.locks.withYardLock(depotId, async () => {
      const plan = await this.getYardPlan(depotId);
      const zone = plan.zones.find((item) => item.name === lado);
      if (!zone && !DEFAULT_YARD_CONFIG.lados.includes(lado as (typeof DEFAULT_YARD_CONFIG.lados)[number])) {
        throw new BadRequestException("Esa zona no está en el plano de este almacén.");
      }
      if (zone) {
        const fit = zoneSlotError(zone, ruma, columna, nivel);
        if (fit) throw new BadRequestException(fit);
      }
      const unit = await this.prisma.container.findUnique({ where: { iso }, select: { iso: true, type: true, archivedAt: true } });
      if (!unit || unit.archivedAt) throw new NotFoundException("Contenedor no encontrado.");
      const sim = await this.readYardSim(depotId);
      const previous = sim.placements.find((item) => item.iso === iso);
      const others = sim.placements.filter((item) => item.iso !== iso);
      const span = baySpan(unit.type, half);
      const storedHalf = span === "A" || span === "B" ? span : null;
      const typed = others.length
        ? await this.prisma.container.findMany({ where: { iso: { in: others.map((item) => item.iso) } }, select: { iso: true, type: true } })
        : [];
      const typeOf = new Map(typed.map((item) => [item.iso, item.type]));
      const stacked = others
        .filter((item) => item.lado && item.lado !== AISLE_SIDE && item.ruma && item.columna && item.nivel)
        .map((item) => ({ zoneName: item.lado, row: item.ruma || 0, col: item.columna || 0, level: item.nivel || 0, type: typeOf.get(item.iso) || "", half: item.half, iso: item.iso }));
      if (stacker && previous?.lado && previous.lado !== AISLE_SIDE && previous.lado !== FENCE_SIDE && previous.ruma && previous.columna && previous.nivel) {
        const from = movesToReach(plan.zones, plan.ghosts, stacked, previous.lado, previous.ruma, previous.columna, previous.nivel, iso, previous.half, unit.type);
        if (from.total) throw new ConflictException(accessBlockMessage(from.above, from.beside));
      }
      if (stacker && previous?.lado === FENCE_SIDE && previous.columna && previous.nivel) {
        const side = plan.perimeter.sides[fenceSideIndex(previous.ruma || 1)];
        const depth = fenceDepthOf(previous.ruma || 1);
        const covered = side && plan.perimeter.cells.some((cell) => cell.sideId === side.id && cell.slot === previous.columna && (cell.row || 1) === depth && cell.level > (previous.nivel || 0) && cell.iso !== iso && fenceCellsOverlap(cell.half, previous.half));
        if (covered) throw new ConflictException(accessBlockMessage(1, 0));
      }
      const taken = others.find((item) => item.lado === lado && item.ruma === ruma && item.columna === columna && item.nivel === nivel && spansOverlap(baySpan(typeOf.get(item.iso), item.half), span));
      if (taken) throw new ConflictException(`${taken.iso} ya ocupa esa posición.`);
      if (zone) {
        if (stacker) {
          const into = movesToReach(plan.zones, plan.ghosts, stacked, lado, ruma, columna, nivel, iso, storedHalf, unit.type);
          if (into.total) throw new ConflictException(STACKER_PLACE_MESSAGE);
        }
        const problem = stackLengthError(zone, plan.ghosts, stacked, unit.type, ruma, columna, nivel, storedHalf);
        if (problem) throw new ConflictException(problem);
        stacked.push({ zoneName: lado, row: ruma, col: columna, level: nivel, type: unit.type, half: storedHalf, iso });
        const cleared = plan.ghosts.filter((ghost) => !(ghost.zoneId === zone.id && ghost.row === ruma && ghost.col === columna && ghost.level === nivel && spansOverlap(baySpan(ghost.typeCode, ghost.half), span)));
        const nextGhosts = ghostsWithSupport(plan.zones, cleared, stacked);
        await this.prisma.appSetting.upsert({
          where: { key: yardPlanKey(depotId) },
          update: { value: { ...plan, ghosts: nextGhosts, perimeter: fenceWithout(plan, iso) } },
          create: { key: yardPlanKey(depotId), value: { ...plan, ghosts: nextGhosts, perimeter: fenceWithout(plan, iso) } },
        });
      } else if (plan.perimeter.cells.some((cell) => cell.iso === iso)) {
        await this.prisma.appSetting.upsert({
          where: { key: yardPlanKey(depotId) },
          update: { value: { ...plan, perimeter: fenceWithout(plan, iso) } },
          create: { key: yardPlanKey(depotId), value: { ...plan, perimeter: fenceWithout(plan, iso) } },
        });
      }
      const fromLabel = previous ? posLabel(previous) : null;
      const detail =
        (fromLabel ? `Simulación: movido de ${fromLabel} a ` : "Simulación: posición asignada: ") +
        `Lado ${lado} · Ruma ${ruma} · Columna ${columna} · Nivel ${nivel}${storedHalf ? ` · mitad ${storedHalf}` : ""}.`;
      await this.writeYardSim(depotId, {
        placements: others.concat([{ iso, lado, ruma, columna, nivel, half: storedHalf }]),
        history: [{ id: randomUUID(), iso, type: "Movimiento", detail, createdAt: new Date().toISOString() }, ...sim.history],
        ...simMeta(sim),
      });
      await this.audit.log({ user, action: "place", entity: "YardDemo", entityId: iso, after: { lado, ruma, columna, nivel }, ip });
      return { ok: true, message: placeSuccessMessage(iso, lado, ruma, columna, nivel) };
    });
  }

  private async leaveDemo(depotId: string, iso: string, nextSide: string | null, user: AuthUser, ip?: string, regularize = false) {
    this.assertYardDemo(user);
    return this.locks.withYardLock(depotId, async () => {
      const sim = await this.readYardSim(depotId);
      const unit = sim.placements.find((item) => item.iso === iso);
      if (!unit?.lado) throw new BadRequestException("Ese equipo no tiene posición en el patio.");
      const plan = await this.getYardPlan(depotId);
      const onAisle = unit.lado === AISLE_SIDE;
      const typed = sim.placements.length
        ? await this.prisma.container.findMany({ where: { iso: { in: sim.placements.map((item) => item.iso) } }, select: { iso: true, type: true } })
        : [];
      const typeOf = new Map(typed.map((item) => [item.iso, item.type]));
      const asCell = (item: { iso: string; lado: string; ruma: number | null; columna: number | null; nivel: number | null; half?: "A" | "B" | null }) => ({
        zoneName: item.lado,
        row: item.ruma || 0,
        col: item.columna || 0,
        level: item.nivel || 0,
        type: typeOf.get(item.iso) || "",
        half: item.half,
        iso: item.iso,
      });
      if (!onAisle && unit.ruma && unit.columna && unit.nivel) {
        const zone = plan.zones.find((item) => item.name === unit.lado);
        const stacked = sim.placements
          .filter((item) => item.iso !== iso && item.lado === unit.lado && item.ruma && item.columna && item.nivel)
          .map(asCell);
        const sameColumn = stacked.filter((item) => item.row === unit.ruma && item.col === unit.columna && item.level > (unit.nivel || 0) && spansOverlap(baySpan(item.type, item.half), baySpan(typeOf.get(iso), unit.half))).length;
        const access = zone
          ? movesToReach(plan.zones, plan.ghosts, stacked, unit.lado, unit.ruma, unit.columna, unit.nivel, iso, unit.half, typeOf.get(iso))
          : { above: sameColumn, beside: 0, total: sameColumn };
        if (access.above || (!regularize && access.total)) throw new ConflictException(accessBlockMessage(access.above, regularize ? 0 : access.beside));
      }
      const fromLabel = posLabel(unit);
      const rest = sim.placements.filter((item) => item.iso !== iso);
      const placements = nextSide ? rest.concat([{ iso, lado: nextSide, ruma: null, columna: null, nivel: null, half: null }]) : rest;
      const stacked = placements
        .filter((item) => item.lado && item.lado !== AISLE_SIDE && item.ruma && item.columna && item.nivel)
        .map(asCell);
      const ghosts = ghostsWithSupport(plan.zones, plan.ghosts, stacked);
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value: { ...plan, ghosts, perimeter: fenceWithout(plan, iso) } },
        create: { key: yardPlanKey(depotId), value: { ...plan, ghosts, perimeter: fenceWithout(plan, iso) } },
      });
      const detail = nextSide
        ? `Simulación: quedó en el pasillo, en el suelo. Salía de ${fromLabel}.`
        : `Simulación: devuelto a sin posición. Salía de ${fromLabel}.`;
      await this.writeYardSim(depotId, {
        placements,
        history: [{ id: randomUUID(), iso, type: "Movimiento", detail, createdAt: new Date().toISOString() }, ...sim.history],
        ...simMeta(sim),
      });
      await this.audit.log({ user, action: nextSide ? "aisle" : "release", entity: "YardDemo", entityId: iso, after: { lado: nextSide }, ip });
      return { ok: true, message: detail };
    });
  }

  private async resetDemo(depotId: string, user: AuthUser, ip?: string) {
    return this.locks.withYardLock(depotId, async () => {
      const sim = await this.readYardSim(depotId);
      const plan = await this.getYardPlan(depotId);
      await this.writeYardSim(depotId, { placements: [], history: [], scenarioId: sim.scenarioId, withPerimeter: sim.withPerimeter });
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value: { ...plan, ghosts: [], perimeter: { ...plan.perimeter, cells: [] } } },
        create: { key: yardPlanKey(depotId), value: { ...plan, ghosts: [], perimeter: { ...plan.perimeter, cells: [] } } },
      });
      await this.audit.log({ user, action: "reset", entity: "YardDemo", entityId: depotId, after: { cleared: sim.placements.length }, ip });
      return {
        ok: true,
        cleared: sim.placements.length,
        message: sim.placements.length
          ? `Simulación reiniciada. ${sim.placements.length} equipo(s) volvieron a sin posición.`
          : "La simulación ya estaba sin posiciones.",
      };
    });
  }

  async loadDemoScenario(depotId: string, scenarioId: string, withPerimeter: boolean, user: AuthUser, ip?: string) {
    this.assertYardDemo(user);
    if (depotId !== YARD_DEMO_2_ID) throw new BadRequestException("Los escenarios se cargan en el depósito demo 2.");
    const scenario = yardScenario(scenarioId, withPerimeter);
    if (!scenario) throw new BadRequestException("Ese escenario no existe.");
    return this.locks.withYardLock(depotId, async () => {
      const live = await this.prisma.liveContainers();
      const stock = await this.prisma.container.findMany({
        where: { ...live, status: { notIn: ["Vendido", "Alquilado", "Retirado por cliente"] } },
        select: { iso: true, type: true },
      });
      const loaded = stockDemoYard(
        scenario.plan.zones.map((zone) => ({ name: zone.name, rows: zone.rows, cols: zone.cols, levels: zone.levels })),
        scenario.plan.perimeter,
        "cargado",
        stock.map((item) => ({ iso: item.iso, feet: feetOf(item.type) })),
      );
      const now = new Date().toISOString();
      const fencePlacements = loaded.fence.map((cell) => {
        const sideIndex = scenario.plan.perimeter.sides.findIndex((side) => side.id === cell.sideId);
        return { iso: cell.iso, lado: FENCE_SIDE, ruma: fenceSeat(sideIndex), columna: cell.slot, nivel: cell.level, half: cell.half || null };
      });
      const placements = [
        ...loaded.placed.map((item) => ({ iso: item.iso, lado: item.lado, ruma: item.ruma, columna: item.columna, nivel: item.nivel, half: item.half })),
        ...fencePlacements,
      ];
      const plan = { ...scenario.plan, ghosts: [], perimeter: { ...scenario.plan.perimeter, cells: loaded.fence.map((cell) => ({ sideId: cell.sideId, slot: cell.slot, level: cell.level, iso: cell.iso, ...(cell.half ? { half: cell.half } : {}) })) } };
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value: plan },
        create: { key: yardPlanKey(depotId), value: plan },
      });
      await this.writeYardSim(depotId, {
        placements,
        history: placements.slice(0, 300).map((item) => ({
          id: randomUUID(),
          iso: item.iso,
          type: "Movimiento",
          detail: item.lado === FENCE_SIDE
            ? `Simulación: ${scenario.name}. Cerco · puesto ${item.columna} · nivel ${item.nivel}.`
            : `Simulación: ${scenario.name}. ${posLabel(item)}.`,
          createdAt: now,
        })),
        scenarioId,
        withPerimeter,
        rumaTemplateId: "cargado",
      });
      await this.audit.log({
        user,
        action: "load",
        entity: "YardDemo",
        entityId: depotId,
        after: { scenarioId, withPerimeter, zones: scenario.plan.zones.length, placed: loaded.placed.length, fence: loaded.fence.length },
        ip,
      });
      const fence = withPerimeter ? "con perímetro" : "sin perímetro";
      const cerco = loaded.fence.length ? ` ${loaded.fence.length} en el cerco.` : "";
      return { ok: true, message: `${scenario.name} cargado, ${fence}. ${loaded.placed.length} equipo(s) en las rumas.${cerco} Un 40 va sobre un 40 o sobre dos de 20.` };
    });
  }

  async loadRumaTemplate(depotId: string, templateId: string, user: AuthUser, ip?: string) {
    this.assertYardDemo(user);
    if (!isYardDemo(depotId)) throw new BadRequestException("Las plantillas de rumas se cargan en un depósito demo.");
    const template = yardRumaTemplate(templateId);
    if (!template) throw new BadRequestException("Esa plantilla de rumas no existe.");
    return this.locks.withYardLock(depotId, async () => {
      const plan = await this.getYardPlan(depotId);
      if (!plan.zones.length) throw new BadRequestException("Este depósito no tiene zonas. Carga un escenario antes de las rumas.");
      const live = await this.prisma.liveContainers();
      const stock = await this.prisma.container.findMany({
        where: { ...live, status: { notIn: ["Vendido", "Alquilado", "Retirado por cliente"] } },
        select: { iso: true, type: true },
      });
      const loaded = stockDemoYard(
        plan.zones.map((zone) => ({ name: zone.name, rows: zone.rows, cols: zone.cols, levels: zone.levels })),
        plan.perimeter,
        templateId,
        stock.map((item) => ({ iso: item.iso, feet: feetOf(item.type) })),
      );
      if (!loaded.placed.length) throw new BadRequestException("No hay equipos a la mano para armar esas rumas.");
      const sim = await this.readYardSim(depotId);
      const now = new Date().toISOString();
      const fencePlacements = loaded.fence.map((cell) => {
        const sideIndex = plan.perimeter.sides.findIndex((side) => side.id === cell.sideId);
        return { iso: cell.iso, lado: FENCE_SIDE, ruma: fenceSeat(sideIndex), columna: cell.slot, nivel: cell.level, half: cell.half || null };
      });
      const placements = [
        ...loaded.placed.map((item) => ({ iso: item.iso, lado: item.lado, ruma: item.ruma, columna: item.columna, nivel: item.nivel, half: item.half })),
        ...fencePlacements,
      ];
      const cells = loaded.fence.map((cell) => ({ sideId: cell.sideId, slot: cell.slot, level: cell.level, iso: cell.iso, ...(cell.half ? { half: cell.half } : {}) }));
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value: { ...plan, ghosts: [], perimeter: { ...plan.perimeter, cells } } },
        create: { key: yardPlanKey(depotId), value: { ...plan, ghosts: [], perimeter: { ...plan.perimeter, cells } } },
      });
      await this.writeYardSim(depotId, {
        placements,
        history: placements.slice(0, 300).map((item) => ({
          id: randomUUID(),
          iso: item.iso,
          type: "Movimiento",
          detail: item.lado === FENCE_SIDE
            ? `Simulación: plantilla ${template.name}. Cerco · puesto ${item.columna} · nivel ${item.nivel}.`
            : `Simulación: plantilla ${template.name}. ${posLabel(item)}.`,
          createdAt: now,
        })),
        scenarioId: sim.scenarioId,
        withPerimeter: sim.withPerimeter,
        rumaTemplateId: templateId,
      });
      await this.audit.log({
        user,
        action: "load",
        entity: "YardDemo",
        entityId: depotId,
        after: { templateId, placed: loaded.placed.length, fence: loaded.fence.length },
        ip,
      });
      const cerco = loaded.fence.length ? ` ${loaded.fence.length} en el cerco.` : "";
      return { ok: true, placed: loaded.placed.length, message: `${template.name}: ${loaded.placed.length} equipo(s) en las rumas.${cerco} Un 40 va sobre un 40 o sobre dos de 20. El patio real no cambió.` };
    });
  }

  async yardLayout(depotId: string, user?: AuthUser) {
    const simulation = isYardDemo(depotId);
    if (simulation) {
      if (!user || (user.role !== "superadmin" && user.role !== "admin")) {
        throw new ForbiddenException("Solo el administrador y el superadmin usan el depósito demo.");
      }
    }
    const depot = simulation ? null : await this.prisma.depot.findUnique({ where: { id: depotId } });
    if (!simulation && !depot) throw new NotFoundException("Depósito no encontrado.");
    const live = await this.prisma.liveContainers();
    const [types, categories, depots, rules, storedRows, sim] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.depot.findMany({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }),
      this.getLayoutRules(),
      simulation
        ? this.prisma.container.findMany({ where: live })
        : this.prisma.container.findMany({ where: { depotId, ...live } }),
      simulation ? this.readYardSim(depotId) : Promise.resolve(null),
    ]);
    const placed = new Map((sim?.placements || []).map((item) => [item.iso, item]));
    const rows = simulation
      ? storedRows.map((row) => {
          const spot = placed.get(row.iso);
          return {
            ...row,
            lado: spot?.lado ?? null,
            ruma: spot?.ruma ?? null,
            columna: spot?.columna ?? null,
            nivel: spot?.nivel ?? null,
            bayHalf: spot?.half ?? null,
          };
        })
      : storedRows;
    const typeMap = Object.fromEntries(types.map((t) => [t.code, t]));
    const catMap = Object.fromEntries(categories.map((c) => [c.code, c]));
    const storedPlan = await this.getYardPlan(depotId);
    const stacked = rows
      .filter((item) => item.lado && item.ruma && item.columna && item.nivel)
      .map((item) => ({
        zoneName: item.lado || "",
        row: item.ruma || 0,
        col: item.columna || 0,
        level: item.nivel || 0,
        type: item.type,
        half: asBayHalf(item.bayHalf),
        iso: item.iso,
      }));
    const plan = { ...storedPlan, ghosts: ghostsWithSupport(storedPlan.zones, storedPlan.ghosts, stacked) };
    const occupants = rows.filter((c) => c.lado).map(toYardUnit);
    const units = rows.map((c) => {
      const yu = toYardUnit(c);
      return {
        iso: c.iso,
        type: c.type,
        typeLabel: typeMap[c.type]?.label || c.type,
        typeColor: typeMap[c.type]?.color || "#8a90a2",
        cat: c.cat,
        catLabel: catMap[c.cat]?.label || c.cat,
        catColor: catMap[c.cat]?.color || "#495057",
        status: c.status,
        intakeType: c.intakeType,
        intakeLabel:
          c.intakeType === "compra"
            ? "Compra"
            : c.intakeType === "almacenaje_cliente"
              ? "Almacenaje cliente"
              : "Pendiente factura",
        manufacturer: c.manufacturer,
        color: c.color,
        lado: c.lado,
        ruma: c.ruma,
        columna: c.columna,
        nivel: c.nivel,
        bayHalf: c.bayHalf === "A" || c.bayHalf === "B" ? c.bayHalf : null,
        physicallyReceived: c.physicallyReceived,
        committed: containerCommitted(c),
        needsPlacement: needsYardPlacement(c),
        posLabel: (c.lado === FENCE_SIDE
          ? `Cerco · ${plan.perimeter.sides[fenceSideIndex(c.ruma || 1)]?.name || "lado"} · puesto ${c.columna}${fenceDepthOf(c.ruma || 1) > 1 ? ` · fila ${fenceDepthOf(c.ruma || 1)}` : ""} · nivel ${c.nivel}`
          : posLabel(c)) + (c.bayHalf === "A" || c.bayHalf === "B" ? ` · mitad ${c.bayHalf}` : ""),
        onAisle: c.lado === AISLE_SIDE,
        movesToRetrieve: c.lado === AISLE_SIDE
          ? 0
          : c.lado
            ? movesToReach(plan.zones, plan.ghosts, stacked, c.lado, c.ruma || 0, c.columna || 0, c.nivel || 0, c.iso, c.bayHalf, c.type).total
            : 0,
        demo: c.demo,
      };
    });
    const listed = depots.map((item) => ({ id: item.id, name: item.name }));
    if (user && (user.role === "superadmin" || user.role === "admin")) {
      listed.push({ id: YARD_DEMO_ID, name: "Depósito demo" });
      listed.push({ id: YARD_DEMO_2_ID, name: "Depósito demo 2" });
    }
    return {
      depotId,
      depotName: simulation ? demoDepotName(depotId) : depot!.name,
      simulation,
      scenarios: depotId === YARD_DEMO_2_ID ? YARD_SCENARIOS : [],
      rumas: simulation ? YARD_RUMA_TEMPLATES.map(({ id, name, detail }) => ({ id, name, detail })) : [],
      activeScenario: sim?.scenarioId || "",
      activeRuma: sim?.rumaTemplateId || "",
      withPerimeter: sim?.withPerimeter === true,
      depots: listed,
      types,
      categories,
      config: DEFAULT_YARD_CONFIG,
      plan,
      retrieval: await readMovementPolicy(this.prisma),
      rules,
      units,
      exits: await this.prisma.yardExit.findMany({
        where: { depotId, status: "pendiente" },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
      occupants: units.filter((u) => u.lado),
      unassigned: units.filter((u) => u.needsPlacement),
    };
  }

  async suggest(depotId: string, iso: string) {
    const c = await this.loadUnit(iso);
    const rules = await this.getLayoutRules();
    const occupants = (await this.prisma.container.findMany({ where: { depotId, lado: { not: null } } })).map(
      toYardUnit,
    );
    return {
      iso: c.iso,
      slot: bestSlotFor(occupants, depotId, c.type, c.cat, DEFAULT_YARD_CONFIG, rules),
    };
  }

  async place(
    input: { iso?: string; depotId?: string; lado?: string; ruma?: number; columna?: number; nivel?: number; regularize?: boolean; stacker?: boolean; half?: string },
    user: AuthUser,
    ip?: string,
  ) {
    const iso = (input.iso || "").trim().toUpperCase();
    const depotId = input.depotId || "";
    const lado = input.lado || "";
    const ruma = Number(input.ruma);
    const columna = Number(input.columna);
    const nivel = Number(input.nivel);
    if (!iso || !depotId || !lado || !ruma || !columna || !nivel) {
      throw new BadRequestException("iso, depotId, lado, ruma, columna y nivel son obligatorios.");
    }
    const half = input.half === "A" || input.half === "B" ? input.half : null;
    if (isYardDemo(depotId)) return this.placeInDemo(depotId, iso, lado, ruma, columna, nivel, half, input.stacker === true, user, ip);
    const plan = await this.getYardPlan(depotId);
    const zone = plan.zones.find((item) => item.name === lado);
    if (!zone && !DEFAULT_YARD_CONFIG.lados.includes(lado as (typeof DEFAULT_YARD_CONFIG.lados)[number])) {
      throw new BadRequestException("Esa zona no está en el plano de este almacén.");
    }
    if (zone && input.regularize) {
      const fit = zoneSlotError(zone, ruma, columna, nivel);
      if (fit) throw new BadRequestException(fit);
    }
    const depot = await this.prisma.depot.findUnique({ where: { id: depotId } });
    if (!depot) throw new BadRequestException("Depósito inválido.");
    const rules = await this.getLayoutRules();

    return this.locks.withYardLock(depotId, async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT iso FROM "Container" WHERE "depotId" = ${depotId} FOR UPDATE`;
          const unit = await tx.container.findUnique({ where: { iso } });
          if (!unit) throw new NotFoundException("Contenedor no encontrado.");
          const occupants = (
            await tx.container.findMany({
              where: { depotId, lado: { not: null } },
            })
          ).map(toYardUnit);
          const span = baySpan(unit.type, half);
          const storedHalf = span === "A" || span === "B" ? span : null;
          const taken = occupants.find(
            (item) => item.iso !== unit.iso && item.lado === lado && item.ruma === ruma && item.columna === columna && item.nivel === nivel
              && spansOverlap(baySpan(item.type, item.bayHalf), span),
          );
          if (zone) {
            const stacked = occupants
              .filter((item) => item.iso !== unit.iso && item.lado && item.lado !== AISLE_SIDE && item.ruma && item.columna && item.nivel)
              .map((item) => ({
                zoneName: item.lado || "",
                row: item.ruma || 0,
                col: item.columna || 0,
                level: item.nivel || 0,
                type: item.type,
                half: asBayHalf(item.bayHalf),
                iso: item.iso,
              }));
            const problem = stackLengthError(zone, plan.ghosts, stacked, unit.type, ruma, columna, nivel, storedHalf);
            if (problem) throw new ConflictException(problem);
            if (input.stacker) {
              if (unit.lado && unit.lado !== AISLE_SIDE && unit.lado !== FENCE_SIDE && unit.ruma && unit.columna && unit.nivel) {
                const from = movesToReach(plan.zones, plan.ghosts, stacked, unit.lado, unit.ruma, unit.columna, unit.nivel, unit.iso, asBayHalf(unit.bayHalf), unit.type);
                if (from.total) throw new ConflictException(accessBlockMessage(from.above, from.beside));
              }
              if (unit.lado === FENCE_SIDE && unit.columna && unit.nivel) {
                const fenceLevel = unit.nivel;
                const side = plan.perimeter.sides[fenceSideIndex(unit.ruma || 1)];
                const depth = fenceDepthOf(unit.ruma || 1);
                const covered = side && plan.perimeter.cells.some((cell) => cell.sideId === side.id && cell.slot === unit.columna && (cell.row || 1) === depth && cell.level > fenceLevel && cell.iso !== unit.iso && fenceCellsOverlap(cell.half, unit.bayHalf));
                if (covered) throw new ConflictException(accessBlockMessage(1, 0));
              }
              const into = movesToReach(plan.zones, plan.ghosts, stacked, lado, ruma, columna, nivel, unit.iso, storedHalf, unit.type);
              if (into.total) throw new ConflictException(STACKER_PLACE_MESSAGE);
            }
          }
          if (zone && input.regularize) {
            if (taken) throw new ConflictException(`${taken.iso} ya ocupa esa posición.`);
          } else {
            const result = validateMove(
              occupants,
              toYardUnit(unit),
              depotId,
              lado,
              ruma,
              columna,
              nivel,
              DEFAULT_YARD_CONFIG,
              rules,
            );
            if (!result.ok) throw new ConflictException(result.message);
          }
          if (unit.lado === FENCE_SIDE) await this.stripFenceIso(tx, depotId, iso);
          const fromLabel = unit.lado ? posLabel(unit) : null;
          if (unit.lado) {
            await tx.containerPosition.updateMany({
              where: { iso: unit.iso, closedAt: null },
              data: { closedAt: new Date() },
            });
          }
          await tx.container.update({
            where: { iso: unit.iso },
            data: {
              depotId,
              lado,
              ruma,
              columna,
              nivel,
              bayHalf: storedHalf,
              physicallyReceived: true,
              ...(unit.status === "Pendiente de ingreso" ? { status: "Disponible" } : {}),
            },
          });
          await tx.containerPosition.create({
            data: { iso: unit.iso, depotId, lado, ruma, columna, nivel },
          });
          let accessNote = "";
          if (zone && input.regularize) {
            const cleared = plan.ghosts.filter(
              (ghost) => !(ghost.zoneId === zone.id && ghost.row === ruma && ghost.col === columna && ghost.level === nivel && spansOverlap(baySpan(ghost.typeCode, ghost.half), span)),
            );
            const column = occupants
              .filter((item) => item.iso !== unit.iso && item.lado && item.ruma && item.columna && item.nivel)
              .map((item) => ({
                zoneName: item.lado || "",
                row: item.ruma || 0,
                col: item.columna || 0,
                level: item.nivel || 0,
                type: item.type,
                half: asBayHalf(item.bayHalf),
                iso: item.iso,
              }));
            column.push({ zoneName: lado, row: ruma, col: columna, level: nivel, type: unit.type, half: storedHalf, iso: unit.iso });
            const nextGhosts = ghostsWithSupport(plan.zones, cleared, column);
            const access = movesToReach(plan.zones, nextGhosts, column, lado, ruma, columna, nivel, unit.iso, storedHalf, unit.type);
            accessNote = accessPlaceNote(access.above, access.beside);
            await tx.appSetting.upsert({
              where: { key: yardPlanKey(depotId) },
              update: { value: { ...plan, perimeter: fenceWithout(plan, iso), ghosts: nextGhosts } },
              create: { key: yardPlanKey(depotId), value: { ...plan, perimeter: fenceWithout(plan, iso), ghosts: nextGhosts } },
            });
          }
          await tx.containerHistory.create({
            data: {
              iso: unit.iso,
              type: "Movimiento",
              detail:
                (fromLabel ? `Movida de ${fromLabel} a ` : "Posición asignada: ") +
                `Lado ${lado} · Ruma ${ruma} · Columna ${columna} · Nivel ${nivel}${storedHalf ? ` · mitad ${storedHalf}` : ""}.` +
                accessNote,
            },
          });
          if (zone && input.regularize) {
            return {
              ok: true,
              message: placeSuccessMessage(unit.iso, lado, ruma, columna, nivel) + accessNote,
            };
          }
          return {
            ok: true,
            message: placeSuccessMessage(unit.iso, lado, ruma, columna, nivel),
          };
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new ConflictException("Esa posición ya está ocupada.");
        }
        throw e;
      }
    }).then(async (out) => {
      await this.audit.log({
        user,
        action: "place",
        entity: "Container",
        entityId: iso,
        after: { depotId, lado, ruma, columna, nivel },
        ip,
      });
      return out;
    });
  }

  private async assignFenceDemo(
    depotId: string,
    input: { sideId?: string; slot?: number; level?: number; row?: number; iso?: string; wall?: boolean; move?: boolean; half?: string; unknown?: boolean; color?: string; typeCode?: string; note?: string; kind?: string; clear?: boolean },
    user: AuthUser,
    ip: string | undefined,
    plan: YardPlan,
    side: YardPlan["perimeter"]["sides"][number],
    sideIndex: number,
  ) {
    this.assertYardDemo(user);
    const sideId = side.id;
    const slot = Math.round(Number(input.slot));
    const level = Math.round(Number(input.level) || 1);
    const iso = String(input.iso || "").trim().toUpperCase();
    return this.locks.withYardLock(depotId, async () => {
      const sim = await this.readYardSim(depotId);
      let cells = plan.perimeter.cells.filter((cell) => !(cell.sideId === sideId && cell.slot === slot && (input.wall === true || cell.level === level)));
      const sides = plan.perimeter.sides.map((item) => item.id === sideId
        ? {
            ...item,
            wallSlots: input.wall === true
              ? [...new Set([...item.wallSlots, slot])]
              : input.wall === false
                ? item.wallSlots.filter((value) => value !== slot)
                : item.wallSlots,
          }
        : item);
      let placements = sim.placements;
      if (input.wall) {
        const freed = new Set(plan.perimeter.cells.filter((cell) => cell.sideId === sideId && cell.slot === slot).map((cell) => cell.iso));
        placements = placements.filter((item) => !freed.has(item.iso));
        cells = cells.filter((cell) => !(cell.sideId === sideId && cell.slot === slot));
      } else if (input.clear) {
        const bay = fenceBays(side).find((item) => item.slot === slot);
        if (!bay) throw new BadRequestException("Ese puesto no cabe en el lado.");
        const depth = input.row === 2 || input.row === 3 ? input.row : 1;
        const half = input.half === "A" || input.half === "B" ? input.half : null;
        const spot = (cell: { sideId: string; slot: number; level: number; row?: number; half?: string | null }) => cell.sideId === sideId && cell.slot === slot && cell.level === level && (cell.row || 1) === depth && fenceCellsOverlap(cell.half, half);
        const target = plan.perimeter.cells.filter((cell) => spot(cell) && cell.unknown);
        if (!target.length) throw new BadRequestException("Ese puesto no tiene un desconocido ni un equipo para quitar.");
        const covered = plan.perimeter.cells.some((cell) => cell.sideId === sideId && cell.slot === slot && cell.level > level && (cell.row || 1) === depth && fenceCellsOverlap(cell.half, half));
        if (covered) throw new ConflictException("Hay un contenedor encima. Muévelo antes de sacar este.");
        cells = plan.perimeter.cells.filter((cell) => !target.includes(cell));
      } else if (iso && input.unknown) {
        const bay = fenceBays(side).find((item) => item.slot === slot);
        if (!bay) throw new BadRequestException("Ese puesto no cabe en el lado.");
        const depth = input.row === 2 || input.row === 3 ? input.row : 1;
        if (depth > bay.rows) throw new BadRequestException("Ese puesto no tiene tantas filas. Guarda el plano con las filas que elegiste.");
        const wanted = String(input.typeCode || "").startsWith("20") ? 20 : bay.feet;
        const half = fenceHalfFor(bay.feet, wanted, input.half);
        const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color || "")) ? String(input.color).toLowerCase() : "";
        const note = String(input.note || "").trim().slice(0, 120);
        const kind = String(input.kind || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 24);
        const displaced = plan.perimeter.cells.filter((cell) => cell.sideId === sideId && cell.slot === slot && cell.level === level && (cell.row || 1) === depth && fenceCellsOverlap(cell.half, half));
        const covered = plan.perimeter.cells.some((cell) => cell.sideId === sideId && cell.slot === slot && cell.level > level && (cell.row || 1) === depth && fenceCellsOverlap(cell.half, half));
        if (input.move && displaced.length && covered) throw new ConflictException("Hay un contenedor encima. Muévelo antes de cambiar este puesto.");
        if (!fenceLevelSupported(plan.perimeter.cells, sideId, slot, level, half, iso, depth)) {
          throw new BadRequestException("Ese puesto no tiene base. Un 40 necesita debajo el puesto completo, o las dos mitades de 20.");
        }
        const dropped = new Set(displaced.filter((cell) => !cell.unknown).map((cell) => cell.iso));
        cells = plan.perimeter.cells.filter((cell) => !displaced.includes(cell));
        placements = placements.filter((item) => !dropped.has(item.iso));
        cells.push({
          sideId,
          slot,
          level,
          iso,
          ...(half ? { half } : {}),
          ...(depth > 1 ? { row: depth } : {}),
          unknown: true,
          ...(wanted === 20 ? { typeCode: "20" } : { typeCode: "40" }),
          ...(color ? { color } : {}),
          ...(note ? { note } : {}),
          ...(kind ? { kind } : {}),
        });
      } else if (iso) {
        const unit = await this.prisma.container.findUnique({ where: { iso }, select: { iso: true, type: true, archivedAt: true } });
        if (!unit || unit.archivedAt) throw new NotFoundException("Contenedor no encontrado.");
        const feet = feetOf(unit.type);
        if (feet !== 20 && feet !== 40) throw new BadRequestException("En el cerco solo entra un contenedor de 20 o de 40 pies.");
        const bay = fenceBays(side).find((item) => item.slot === slot);
        if (!bay) throw new BadRequestException("Ese puesto no cabe en el lado.");
        const depth = input.row === 2 || input.row === 3 ? input.row : 1;
        if (depth > bay.rows) throw new BadRequestException("Ese puesto no tiene tantas filas. Guarda el plano con las filas que elegiste.");
        const half = fenceHalfFor(bay.feet, feet, input.half);
        const current = sim.placements.find((item) => item.iso === iso);
        if (current?.lado && !input.move) throw new BadRequestException("Ese contenedor ya está en el patio. Para llevarlo al cerco usa Trasladar.");
        const typed = sim.placements.length
          ? await this.prisma.container.findMany({ where: { iso: { in: sim.placements.map((item) => item.iso) } }, select: { iso: true, type: true } })
          : [];
        const typeOf = new Map(typed.map((item) => [item.iso, item.type]));
        if (current?.lado && current.lado !== AISLE_SIDE && current.ruma && current.columna && current.nivel) {
          const stacked = sim.placements
            .filter((item) => item.iso !== iso && item.lado === current.lado && item.ruma && item.columna && item.nivel)
            .map((item) => ({
              zoneName: item.lado,
              row: item.ruma || 0,
              col: item.columna || 0,
              level: item.nivel || 0,
              type: typeOf.get(item.iso) || "",
              half: item.half,
              iso: item.iso,
            }));
          const access = movesToReach(plan.zones, plan.ghosts, stacked, current.lado, current.ruma, current.columna, current.nivel, iso, current.half, unit.type);
          if (access.total) throw new ConflictException(accessBlockMessage(access.above, access.beside));
        }
        const sameLevel = plan.perimeter.cells.filter((cell) => cell.sideId === sideId && cell.slot === slot && cell.level === level && (cell.row || 1) === depth && (cell.unknown || cell.iso !== iso));
        const blocked = sameLevel.filter((cell) => fenceCellsOverlap(cell.half, half));
        const aboveCell = plan.perimeter.cells.some((cell) => cell.sideId === sideId && cell.slot === slot && cell.level > level && (cell.row || 1) === depth && (cell.unknown || cell.iso !== iso) && fenceCellsOverlap(cell.half, half));
        if (input.move && blocked.length && aboveCell) throw new ConflictException("Hay un contenedor encima. Muévelo antes de cambiar este puesto.");
        if (!fenceLevelSupported(plan.perimeter.cells, sideId, slot, level, half, iso, depth)) {
          throw new BadRequestException("Ese puesto no tiene base. Un 40 necesita debajo el puesto completo, o las dos mitades de 20.");
        }
        const dropped = new Set(blocked.filter((cell) => !cell.unknown).map((cell) => cell.iso));
        cells = plan.perimeter.cells.filter((cell) => cell.iso !== iso && !dropped.has(cell.iso) && !blocked.includes(cell));
        cells.push({ sideId, slot, level, iso, ...(half ? { half } : {}), ...(depth > 1 ? { row: depth } : {}) });
        placements = sim.placements.filter((item) => item.iso !== iso && !dropped.has(item.iso));
        placements.push({ iso, lado: FENCE_SIDE, ruma: fenceSeat(sideIndex, depth), columna: slot, nivel: level, half });
      } else throw new BadRequestException("Indica el código del contenedor.");
      const perimeter = { ...plan.perimeter, sides, cells };
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value: { ...plan, perimeter } },
        create: { key: yardPlanKey(depotId), value: { ...plan, perimeter } },
      });
      const detail = iso
        ? `Simulación: pasó al cerco, lado ${side.name}, puesto ${slot}, nivel ${level}${input.half === "A" || input.half === "B" ? `, mitad ${input.half}` : ""}.`
        : `Simulación: el puesto ${slot} del lado ${side.name} pasó a pared.`;
      await this.writeYardSim(depotId, {
        placements,
        history: iso ? [{ id: randomUUID(), iso, type: "Movimiento", detail, createdAt: new Date().toISOString() }, ...sim.history] : sim.history,
        ...simMeta(sim),
      });
      const cleared = input.clear ? plan.perimeter.cells.filter((cell) => cell.sideId === sideId && cell.slot === slot && cell.level === level).map((cell) => cell.iso).join(",") : "";
      const yardAction = input.wall
        ? "pasar a pared"
        : input.clear
          ? (cleared === "DESCONOCIDO" ? "quitar desconocido" : "eliminar equipo")
          : iso === "DESCONOCIDO"
            ? "ocupar desconocido"
            : input.unknown
              ? "ubicar equipo"
              : "fence_place";
      await this.audit.log({ user, action: yardAction, entity: "Yard", entityId: iso || cleared || sideId, after: { depotId, side: side.name, slot, level }, ip });
      return { ok: true };
    });
  }

  async assignFence(
    input: { depotId?: string; sideId?: string; slot?: number; level?: number; row?: number; iso?: string; wall?: boolean; move?: boolean; half?: string; unknown?: boolean; color?: string; typeCode?: string; note?: string; kind?: string; clear?: boolean },
    user: AuthUser,
    ip?: string,
  ) {
    const depotId = input.depotId || "";
    const sideId = String(input.sideId || "");
    const slot = Math.round(Number(input.slot));
    const level = Math.round(Number(input.level) || 1);
    const iso = String(input.iso || "").trim().toUpperCase();
    if (!depotId || !sideId || !slot) throw new BadRequestException("Indica el lado y el puesto del cerco.");
    const plan = await this.getYardPlan(depotId);
    const sideIndex = plan.perimeter.sides.findIndex((side) => side.id === sideId);
    const side = plan.perimeter.sides[sideIndex];
    if (!side) throw new BadRequestException("Ese lado no está en el perímetro. Guarda el plano primero.");
    const slots = fenceBays(side).length;
    if (slot < 1 || slot > slots) throw new BadRequestException("Ese puesto no cabe en el lado.");
    if (level < 1 || level > side.levels) throw new BadRequestException(`Ese lado tiene ${side.levels} nivel${side.levels === 1 ? "" : "es"}.`);
    if (isYardDemo(depotId)) return this.assignFenceDemo(depotId, input, user, ip, plan, side, sideIndex);
    return this.locks.withYardLock(depotId, async () => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT iso FROM "Container" WHERE "depotId" = ${depotId} FOR UPDATE`;
      const sides = plan.perimeter.sides.map((item) => item.id === sideId
        ? {
            ...item,
            wallSlots: input.wall === true
              ? [...new Set([...item.wallSlots, slot])]
              : input.wall === false
                ? item.wallSlots.filter((value) => value !== slot)
                : item.wallSlots,
          }
        : item);
      let cells = input.wall === true
        ? plan.perimeter.cells.filter((cell) => !(cell.sideId === sideId && cell.slot === slot))
        : [...plan.perimeter.cells];
      if (!iso && input.wall !== true && input.wall !== false && !input.clear) throw new BadRequestException("Indica el código del contenedor.");
      if (input.wall) {
        const freed = plan.perimeter.cells.filter((cell) => cell.sideId === sideId && cell.slot === slot && !cell.unknown);
        for (const cell of freed) await this.clearYardSpot(tx, cell.iso, depotId);
        cells = cells.filter((cell) => !(cell.sideId === sideId && cell.slot === slot));
      } else if (input.clear) {
        const bay = fenceBays(side).find((item) => item.slot === slot);
        if (!bay) throw new BadRequestException("Ese puesto no cabe en el lado.");
        const depth = input.row === 2 || input.row === 3 ? input.row : 1;
        const half = input.half === "A" || input.half === "B" ? input.half : null;
        const spot = (cell: { sideId: string; slot: number; level: number; row?: number; half?: string | null }) => cell.sideId === sideId && cell.slot === slot && cell.level === level && (cell.row || 1) === depth && fenceCellsOverlap(cell.half, half);
        const target = cells.filter((cell) => spot(cell) && cell.unknown);
        if (!target.length) throw new BadRequestException("Ese puesto no tiene un desconocido ni un equipo para quitar.");
        const covered = cells.some((cell) => cell.sideId === sideId && cell.slot === slot && cell.level > level && (cell.row || 1) === depth && fenceCellsOverlap(cell.half, half));
        if (covered) throw new ConflictException("Hay un contenedor encima. Muévelo antes de sacar este.");
        cells = cells.filter((cell) => !target.includes(cell));
      } else if (iso && input.unknown) {
        const bay = fenceBays(side).find((item) => item.slot === slot);
        if (!bay) throw new BadRequestException("Ese puesto no cabe en el lado.");
        const depth = input.row === 2 || input.row === 3 ? input.row : 1;
        if (depth > bay.rows) throw new BadRequestException("Ese puesto no tiene tantas filas. Guarda el plano con las filas que elegiste.");
        const wanted = String(input.typeCode || "").startsWith("20") ? 20 : bay.feet;
        const half = fenceHalfFor(bay.feet, wanted, input.half);
        const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color || "")) ? String(input.color).toLowerCase() : "";
        const note = String(input.note || "").trim().slice(0, 120);
        const kind = String(input.kind || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 24);
        const displaced = cells.filter((cell) => cell.sideId === sideId && cell.slot === slot && cell.level === level && (cell.row || 1) === depth && fenceCellsOverlap(cell.half, half));
        const covered = cells.some((cell) => cell.sideId === sideId && cell.slot === slot && cell.level > level && (cell.row || 1) === depth && fenceCellsOverlap(cell.half, half));
        if (input.move && displaced.length && covered) throw new ConflictException("Hay un contenedor encima. Muévelo antes de cambiar este puesto.");
        if (!fenceLevelSupported(plan.perimeter.cells, sideId, slot, level, half, iso, depth)) {
          throw new BadRequestException("Ese puesto no tiene base. Un 40 necesita debajo el puesto completo, o las dos mitades de 20.");
        }
        for (const cell of displaced) {
          if (!cell.unknown) await this.clearYardSpot(tx, cell.iso, depotId);
        }
        cells = cells.filter((cell) => !displaced.includes(cell));
        cells.push({
          sideId,
          slot,
          level,
          iso,
          ...(half ? { half } : {}),
          ...(depth > 1 ? { row: depth } : {}),
          unknown: true,
          ...(wanted === 20 ? { typeCode: "20" } : { typeCode: "40" }),
          ...(color ? { color } : {}),
          ...(note ? { note } : {}),
          ...(kind ? { kind } : {}),
        });
      } else if (iso) {
        const unit = await tx.container.findUnique({ where: { iso } });
        if (!unit || unit.depotId !== depotId) throw new NotFoundException("Ese contenedor no está en este almacén.");
        if (["Vendido", "Alquilado", "Retirado por cliente"].includes(unit.status)) {
          throw new BadRequestException("Ese contenedor ya no está en el patio.");
        }
        const feet = feetOf(unit.type);
        if (feet !== 20 && feet !== 40) throw new BadRequestException("En el cerco solo entra un contenedor de 20 o de 40 pies.");
        const bay = fenceBays(side).find((item) => item.slot === slot);
        if (!bay) throw new BadRequestException("Ese puesto no cabe en el lado.");
        const depth = input.row === 2 || input.row === 3 ? input.row : 1;
        if (depth > bay.rows) throw new BadRequestException("Ese puesto no tiene tantas filas. Guarda el plano con las filas que elegiste.");
        const half = fenceHalfFor(bay.feet, feet, input.half);
        if (unit.lado && !input.move) throw new BadRequestException("Ese contenedor ya está en el patio. Para llevarlo al cerco usa Trasladar.");
        if (unit.lado && unit.lado !== AISLE_SIDE && unit.ruma && unit.columna && unit.nivel) {
          const zone = plan.zones.find((item) => item.name === unit.lado);
          const others = await tx.container.findMany({
            where: { depotId, lado: unit.lado, archivedAt: null },
            select: { iso: true, type: true, lado: true, ruma: true, columna: true, nivel: true, bayHalf: true },
          });
          const stacked = others
            .filter((item) => item.iso !== iso && item.ruma && item.columna && item.nivel)
            .map((item) => ({
              zoneName: item.lado || "",
              row: item.ruma || 0,
              col: item.columna || 0,
              level: item.nivel || 0,
              type: item.type,
              half: asBayHalf(item.bayHalf),
              iso: item.iso,
            }));
          const sameColumn = stacked.filter((item) => item.row === unit.ruma && item.col === unit.columna && item.level > (unit.nivel || 0)).length;
          const access = zone
            ? movesToReach(plan.zones, plan.ghosts, stacked, unit.lado, unit.ruma, unit.columna, unit.nivel, iso, unit.bayHalf, unit.type)
            : { above: sameColumn, beside: 0, total: sameColumn };
          if (access.total) throw new ConflictException(accessBlockMessage(access.above, access.beside));
        }
        const sameLevel = plan.perimeter.cells.filter((cell) => cell.sideId === sideId && cell.slot === slot && cell.level === level && (cell.row || 1) === depth && (cell.unknown || cell.iso !== iso));
        const blocked = sameLevel.filter((cell) => fenceCellsOverlap(cell.half, half));
        const aboveCell = plan.perimeter.cells.some((cell) => cell.sideId === sideId && cell.slot === slot && cell.level > level && (cell.row || 1) === depth && (cell.unknown || cell.iso !== iso) && fenceCellsOverlap(cell.half, half));
        if (input.move && blocked.length && aboveCell) throw new ConflictException("Hay un contenedor encima. Muévelo antes de cambiar este puesto.");
        if (!fenceLevelSupported(plan.perimeter.cells, sideId, slot, level, half, iso, depth)) {
          throw new BadRequestException("Ese puesto no tiene base. Un 40 necesita debajo el puesto completo, o las dos mitades de 20.");
        }
        for (const cell of blocked) {
          if (!cell.unknown) await this.clearYardSpot(tx, cell.iso, depotId);
        }
        cells = cells.filter((cell) => cell.iso !== iso && !blocked.includes(cell));
        const seat = fenceSeat(sideIndex, depth);
        const rivals = await tx.container.findMany({
          where: { depotId, lado: FENCE_SIDE, columna: slot, nivel: level, iso: { not: iso }, archivedAt: null },
          select: { iso: true, bayHalf: true, ruma: true },
        });
        for (const other of rivals) {
          if (!fenceCellsOverlap(other.bayHalf, half) || fenceSideIndex(other.ruma || 1) !== sideIndex) continue;
          const home = cells.find((cell) => cell.iso === other.iso && cell.sideId === sideId && cell.slot === slot && cell.level === level)
            || cells.find((cell) => cell.iso === other.iso && cell.sideId === sideId && cell.slot === slot);
          const otherDepth = home ? (home.row || 1) : fenceDepthOf(other.ruma || 1);
          if (otherDepth === depth) {
            await this.clearYardSpot(tx, other.iso, depotId);
            cells = cells.filter((cell) => cell.iso !== other.iso);
          } else if ((other.ruma || 0) !== fenceSeat(sideIndex, otherDepth)) {
            await tx.container.update({ where: { iso: other.iso }, data: { ruma: fenceSeat(sideIndex, otherDepth) } });
          }
        }
        cells.push({ sideId, slot, level, iso, ...(half ? { half } : {}), ...(depth > 1 ? { row: depth } : {}) });
        if (unit.lado) {
          await tx.containerPosition.updateMany({ where: { iso, closedAt: null }, data: { closedAt: new Date() } });
        }
        await tx.container.update({
          where: { iso },
          data: { lado: FENCE_SIDE, ruma: seat, columna: slot, nivel: level, bayHalf: half, physicallyReceived: true },
        });
        await tx.containerPosition.create({
          data: { iso, depotId, lado: FENCE_SIDE, ruma: seat, columna: slot, nivel: level },
        });
        await tx.containerHistory.create({
          data: { iso, type: "Movimiento", detail: `${input.move ? "Trasladado" : "Pasó"} al cerco, lado ${side.name}, puesto ${slot}${depth > 1 ? `, fila ${depth}` : ""}, nivel ${level}${half ? `, mitad ${half}` : ""}.` },
        });
      }
      const perimeter = { ...plan.perimeter, sides, cells };
      await tx.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value: { ...plan, perimeter } },
        create: { key: yardPlanKey(depotId), value: { ...plan, perimeter } },
      });
      const cleared = input.clear ? plan.perimeter.cells.filter((cell) => cell.sideId === sideId && cell.slot === slot && cell.level === level).map((cell) => cell.iso).join(",") : "";
      const yardAction = input.wall
        ? "pasar a pared"
        : input.clear
          ? (cleared === "DESCONOCIDO" ? "quitar desconocido" : "eliminar equipo")
          : iso === "DESCONOCIDO"
            ? "ocupar desconocido"
            : input.unknown
              ? "ubicar equipo"
              : "fence_place";
      await this.audit.log({ user, action: yardAction, entity: "Yard", entityId: iso || cleared || sideId, after: { depotId, side: side.name, slot, level }, ip });
      return { ok: true };
    }));
  }

  async registerExit(
    input: { depotId?: string; iso?: string; destination?: string; note?: string },
    user: AuthUser,
    ip?: string,
  ) {
    const depotId = input.depotId || "";
    const iso = String(input.iso || "").trim().toUpperCase();
    const destination = String(input.destination || "").trim().slice(0, 160);
    if (!depotId || !iso) throw new BadRequestException("Indica el contenedor y el depósito.");
    if (destination.length < 3) throw new BadRequestException("Indica a dónde sale.");
    const unit = await this.prisma.container.findUnique({ where: { iso } });
    if (!unit || unit.depotId !== depotId) throw new NotFoundException("Ese contenedor no está en este almacén.");
    if (!unit.lado) throw new BadRequestException("Primero ubica el contenedor en el patio o en el cerco.");
    const open = await this.prisma.yardExit.findFirst({ where: { iso, depotId, status: "pendiente" } });
    if (open) throw new BadRequestException("Ese contenedor ya tiene una salida pendiente de regularizar.");
    const row = await this.prisma.yardExit.create({
      data: { iso, depotId, destination, note: String(input.note || "").trim().slice(0, 300), createdByName: user.name || "" },
    });
    await this.audit.log({ user, action: "yard_exit", entity: "Container", entityId: iso, after: { destination, pending: true }, ip });
    return row;
  }

  async cancelExit(id: string, user: AuthUser, ip?: string) {
    const row = await this.prisma.yardExit.findUnique({ where: { id } });
    if (!row || row.status !== "pendiente") throw new NotFoundException("Esa salida no está pendiente.");
    const saved = await this.prisma.yardExit.update({
      where: { id },
      data: { status: "anulado", cancelledAt: new Date() },
    });
    await this.audit.log({ user, action: "yard_exit_cancel", entity: "Container", entityId: row.iso, after: { id }, ip });
    return saved;
  }

  private async clearYardSpot(tx: Prisma.TransactionClient, iso: string, depotId: string) {
    await tx.containerPosition.updateMany({ where: { iso, closedAt: null }, data: { closedAt: new Date() } });
    await tx.container.update({ where: { iso }, data: { lado: null, ruma: null, columna: null, nivel: null, bayHalf: null } });
    await tx.containerHistory.create({ data: { iso, type: "Movimiento", detail: "Salió del cerco y quedó sin posición." } });
    void depotId;
  }

  private async stripFenceIso(tx: Prisma.TransactionClient, depotId: string, iso: string) {
    const key = yardPlanKey(depotId);
    const row = await tx.appSetting.findUnique({ where: { key } });
    if (!row) return;
    const plan = normalizeYardPlan(row.value);
    const cells = plan.perimeter.cells.filter((cell) => cell.iso !== iso);
    if (cells.length === plan.perimeter.cells.length) return;
    await tx.appSetting.update({ where: { key }, data: { value: { ...plan, perimeter: { ...plan.perimeter, cells } } } });
  }

  release(iso: string, depotId: string, user: AuthUser, ip?: string, regularize = false) {
    return this.leaveYard(iso, depotId, null, user, ip, regularize);
  }

  holdInAisle(iso: string, depotId: string, user: AuthUser, ip?: string) {
    return this.leaveYard(iso, depotId, AISLE_SIDE, user, ip);
  }

  movementHistory(iso: string, depotId = "") {
    const code = (iso || "").trim().toUpperCase();
    if (isYardDemo(depotId)) {
      return this.readYardSim(depotId).then((sim) =>
        sim.history.filter((row) => row.iso === code).slice(0, 30),
      );
    }
    return this.prisma.containerHistory.findMany({
      where: { iso: code, type: { in: ["Movimiento", "Compactación"] } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, type: true, detail: true, createdAt: true },
    });
  }

  async resetDepot(depotId: string, user: AuthUser, ip?: string) {
    if (!depotId) throw new BadRequestException("Elige un depósito.");
    if (isYardDemo(depotId)) {
      this.assertYardDemo(user);
      return this.resetDemo(depotId, user, ip);
    }
    if (!isSuperadmin(user.role)) throw new ForbiddenException("Solo el superadmin puede reiniciar un depósito.");
    const depot = await this.prisma.depot.findUnique({ where: { id: depotId } });
    if (!depot) throw new NotFoundException("Depósito no encontrado.");
    return this.locks.withYardLock(depotId, async () => {
      const cleared = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT iso FROM "Container" WHERE "depotId" = ${depotId} FOR UPDATE`;
        const rows = await tx.container.findMany({
          where: { depotId, lado: { not: null }, archivedAt: null },
          select: { iso: true, lado: true, ruma: true, columna: true, nivel: true },
        });
        if (rows.length) {
          const now = new Date();
          await tx.containerPosition.updateMany({
            where: { closedAt: null, iso: { in: rows.map((row) => row.iso) } },
            data: { closedAt: now },
          });
          await tx.container.updateMany({
            where: { iso: { in: rows.map((row) => row.iso) } },
            data: { lado: null, ruma: null, columna: null, nivel: null, bayHalf: null },
          });
          await tx.containerHistory.createMany({
            data: rows.map((row) => ({
              iso: row.iso,
              type: "Movimiento",
              detail: `Devuelto a sin posición al reiniciar el depósito. Salía de ${posLabel(row)}.`,
            })),
          });
        }
        const plan = normalizeYardPlan((await tx.appSetting.findUnique({ where: { key: yardPlanKey(depotId) } }))?.value);
        await tx.appSetting.upsert({
          where: { key: yardPlanKey(depotId) },
          update: { value: { ...plan, ghosts: [] } },
          create: { key: yardPlanKey(depotId), value: { ...plan, ghosts: [] } },
        });
        return rows.length;
      });
      await this.audit.log({
        user,
        action: "reset",
        entity: "Depot",
        entityId: depotId,
        after: { cleared, ghosts: 0 },
        ip,
      });
      return {
        ok: true,
        cleared,
        message: cleared
          ? `${cleared} equipo(s) de ${depot.name} volvieron a sin posición.`
          : `${depot.name} ya estaba sin posiciones.`,
      };
    });
  }

  private async leaveYard(iso: string, depotId: string, nextSide: string | null, user: AuthUser, ip?: string, regularize = false) {
    const code = (iso || "").trim().toUpperCase();
    if (!code || !depotId) throw new BadRequestException("iso y depósito son obligatorios.");
    if (isYardDemo(depotId)) return this.leaveDemo(depotId, code, nextSide, user, ip, regularize);
    const plan = await this.getYardPlan(depotId);
    return this.locks.withYardLock(depotId, async () => {
      const out = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT iso FROM "Container" WHERE "depotId" = ${depotId} FOR UPDATE`;
        const unit = await tx.container.findUnique({ where: { iso: code } });
        if (!unit || unit.depotId !== depotId) throw new NotFoundException("Ese equipo no está en este almacén.");
        if (!unit.lado) throw new BadRequestException("Ese equipo no tiene posición en el patio.");
        const onAisle = unit.lado === AISLE_SIDE;
        if (!onAisle && unit.ruma && unit.columna && unit.nivel) {
          const zone = plan.zones.find((item) => item.name === unit.lado);
          const others = await tx.container.findMany({
            where: { depotId, lado: unit.lado, archivedAt: null },
            select: { iso: true, type: true, lado: true, ruma: true, columna: true, nivel: true, bayHalf: true },
          });
          const stacked = others
            .filter((item) => item.iso !== unit.iso && item.ruma && item.columna && item.nivel)
            .map((item) => ({
              zoneName: item.lado || "",
              row: item.ruma || 0,
              col: item.columna || 0,
              level: item.nivel || 0,
              type: item.type,
              half: asBayHalf(item.bayHalf),
              iso: item.iso,
            }));
          const sameColumn = stacked.filter((item) => item.row === unit.ruma && item.col === unit.columna && item.level > (unit.nivel || 0)).length;
          const access = zone
            ? movesToReach(plan.zones, plan.ghosts, stacked, unit.lado || "", unit.ruma, unit.columna, unit.nivel, unit.iso, unit.bayHalf, unit.type)
            : { above: sameColumn, beside: 0, total: sameColumn };
          if (access.above || (!regularize && access.total)) throw new ConflictException(accessBlockMessage(access.above, regularize ? 0 : access.beside));
        }
        const fromLabel = posLabel(unit);
        await tx.containerPosition.updateMany({
          where: { iso: unit.iso, closedAt: null },
          data: { closedAt: new Date() },
        });
        await tx.container.update({
          where: { iso: unit.iso },
          data: { lado: nextSide, ruma: null, columna: null, nivel: null, bayHalf: null },
        });
        const remaining = await tx.container.findMany({
          where: { depotId, lado: { not: null }, archivedAt: null },
          select: { iso: true, type: true, lado: true, ruma: true, columna: true, nivel: true, bayHalf: true },
        });
        const stacked = remaining
          .filter((item) => item.lado && item.lado !== AISLE_SIDE && item.ruma && item.columna && item.nivel)
          .map((item) => ({
            zoneName: item.lado || "",
            row: item.ruma || 0,
            col: item.columna || 0,
            level: item.nivel || 0,
            type: item.type,
            half: asBayHalf(item.bayHalf),
            iso: item.iso,
          }));
        const perimeter = fenceWithout(plan, unit.iso);
        await tx.appSetting.upsert({
          where: { key: yardPlanKey(depotId) },
          update: { value: { ...plan, perimeter, ghosts: ghostsWithSupport(plan.zones, plan.ghosts, stacked) } },
          create: { key: yardPlanKey(depotId), value: { ...plan, perimeter, ghosts: ghostsWithSupport(plan.zones, plan.ghosts, stacked) } },
        });
        const detail = nextSide
          ? `Quedó en el pasillo, en el suelo, a la espera de un lugar. Salía de ${fromLabel}.`
          : `Devuelto a sin posición. Salía de ${fromLabel}.`;
        await tx.containerHistory.create({ data: { iso: unit.iso, type: "Movimiento", detail } });
        return { ok: true, message: detail };
      });
      await this.audit.log({
        user,
        action: nextSide ? "aisle" : "release",
        entity: "Container",
        entityId: code,
        after: { depotId, lado: nextSide },
        ip,
      });
      return out;
    });
  }

  async compact(depotId: string, user: AuthUser, ip?: string) {
    if (isYardDemo(depotId)) throw new BadRequestException("El depósito demo se arma a mano. No se compacta.");
    const depot = await this.prisma.depot.findUnique({ where: { id: depotId } });
    if (!depot) throw new NotFoundException("Depósito no encontrado.");
    return this.locks.withYardLock(depotId, async () => {
      return this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT iso FROM "Container" WHERE "depotId" = ${depotId} FOR UPDATE`;
        const rows = await tx.container.findMany({ where: { depotId, lado: { not: null } } });
        const occupants = rows.map(toYardUnit);
        const changes = compactYardGravity(occupants, DEFAULT_YARD_CONFIG);
        for (const ch of changes) {
          await tx.container.update({
            where: { iso: ch.iso },
            data: { nivel: ch.toNivel },
          });
          await tx.containerPosition.updateMany({
            where: { iso: ch.iso, closedAt: null },
            data: { closedAt: new Date() },
          });
          await tx.containerPosition.create({
            data: {
              iso: ch.iso,
              depotId: ch.depotId,
              lado: ch.lado,
              ruma: ch.ruma,
              columna: ch.columna,
              nivel: ch.toNivel,
            },
          });
          await tx.containerHistory.create({
            data: {
              iso: ch.iso,
              type: "Compactación",
              detail: `Compactación por gravedad: Nivel ${ch.fromNivel} → Nivel ${ch.toNivel} en Lado ${ch.lado} · Ruma ${ch.ruma} · Columna ${ch.columna}.`,
            },
          });
        }
        await this.audit.log({
          user,
          action: "compact",
          entity: "Depot",
          entityId: depotId,
          after: { moved: changes.length },
          ip,
        });
        return { ok: true, moved: changes.length, changes };
      });
    });
  }

  private async storeInspectionPhoto(
    c: ContainerRow,
    slot: number,
    buffer: Buffer,
    originalNameRaw: string,
    sizeBytes: number,
    user: AuthUser,
    ip: string | undefined,
    replaceNote: string,
    source = "zdry",
  ) {
    if (sizeBytes > MAX_INSPECTION_PHOTO_BYTES) {
      throw new BadRequestException("La foto supera el máximo de 8 MB.");
    }
    let mime: string;
    try {
      mime = sniffInspectionPhotoMime(buffer);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const ext = extForInspectionMime(mime);
    const photoId = randomUUID();
    const storageKey = `warehouse/${c.iso}/photos/${photoId}.${ext}`;
    await this.storage.put(storageKey, buffer, mime);
    const originalName = String(originalNameRaw || `foto-${slot + 1}.${ext}`)
      .replace(/[/\\]/g, "_")
      .slice(0, 180);
    const previous = await this.prisma.inspectionPhoto.findFirst({
      where: { iso: c.iso, slot, status: PHOTO_STATUS_ACTIVE },
    });
    if (previous) {
      await this.archivePhoto(previous, user, replaceNote);
    }
    await this.prisma.inspectionPhoto.create({
      data: {
        id: photoId,
        iso: c.iso,
        slot,
        storageKey,
        mimeType: mime,
        originalName,
        sizeBytes,
        status: PHOTO_STATUS_ACTIVE,
        source,
      },
    });
    await this.audit.log({
      user,
      action: "upload",
      entity: "InspectionPhoto",
      entityId: c.iso,
      after: { slot, storageKey, fromOdoo: replaceNote.includes("Odoo") },
      ip,
    });
  }

  private presentUnit(
    c: ContainerRow,
    types: { code: string; label: string; color: string }[],
    categories: { code: string; label: string; color: string }[],
    suggested: ReturnType<typeof bestSlotFor>,
    hideOdoo = false,
    hideOdooIds = hideOdoo,
  ) {
    const typeRow = types.find((t) => t.code === c.type);
    const catRow = categories.find((x) => x.code === c.cat);
    const photoSlots = Array.from({ length: 9 }, (_, i) => !!c.photos.find((p) => p.slot === i && p.status !== PHOTO_STATUS_REJECTED));
    return {
      iso: c.iso,
      type: c.type,
      typeLabel: typeRow?.label || c.type,
      cat: c.cat,
      catLabel: catRow?.label || c.cat,
      catColor: catRow?.color || "#495057",
      status: c.status,
      year: c.year,
      manufacturer: c.manufacturer,
      depotId: c.depotId,
      depotName: c.depot.name,
      depotCode: c.depot.code,
      odooWarehouse: hideOdoo ? null : c.odooWarehouse || warehouseFromLocation(c.odooLocation),
      odooWarehouseLabel: hideOdoo ? null : warehouseLabel(c.odooWarehouse || warehouseFromLocation(c.odooLocation)),
      needsPatioChoice: needsPatioChoice(c.odooWarehouse || warehouseFromLocation(c.odooLocation), c.depot.code),
      lado: c.lado,
      ruma: c.ruma,
      columna: c.columna,
      nivel: c.nivel,
      posLabel: posLabel(c),
      tareKg: c.tareKg,
      mgwKg: c.mgwKg,
      payloadKg: c.payloadKg,
      color: c.color,
      inspectionNotes: c.inspectionNotes,
      conditionFloor: c.conditionFloor,
      conditionRoof: c.conditionRoof,
      conditionDoors: c.conditionDoors,
      conditionPaint: c.conditionPaint,
      gateIn: c.gateIn,
      gateOut: c.gateOut,
      intakeType: c.intakeType,
      intakeLabel: intakeTypeLabel(c.intakeType),
      physicallyReceived: c.physicallyReceived,
      registeredByName: c.registeredByName || "—",
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
      archiveReason: c.archiveReason,
      ownerCustomer: c.ownerCustomer,
      storageDiscountPct: Number(c.storageDiscountPct),
      photos: photoSlots,
      photoOrigins: Array.from({ length: 9 }, (_, i) => {
        const p = c.photos.find((x) => x.slot === i && x.status !== PHOTO_STATUS_REJECTED);
        return p ? p.source || "zdry" : null;
      }),
      hasVideo: !!c.video360Key,
      mediaStatus: c.mediaStatus,
      mediaReviewNote: c.mediaReviewNote,
      mediaApprovedAt: c.mediaApprovedAt,
      intakeOrigin: c.intakeOrigin,
      isoException: c.isoException,
      isoExceptionReason: c.isoExceptionReason,
      campoEnabledAt: c.campoEnabledAt,
      campoEnabledByName: c.campoEnabledByName,
      material: hideOdoo ? null : c.material,
      odooDescription: hideOdoo ? "" : c.odooDescription,
      conditionWalls: c.conditionWalls,
      roofHole: c.roofHole,
      odooLotId: hideOdooIds ? null : c.odooLotId,
      hasOdooChatter: !!c.odooLotId,
      canPushOdooRef: !!c.odooLotId,
      odooRefSlot: c.odooRefSlot,
      odooRefPushedAt: c.odooRefPushedAt,
      odooRefAttachmentId: hideOdooIds ? null : c.odooRefAttachmentId,
      odooLocation: hideOdooIds ? null : c.odooLocation,
      odooDua: hideOdoo ? null : c.odooDua,
      originCountry: hideOdoo ? null : c.originCountry,
      odooSource: hideOdooIds ? null : c.odooSource,
      lotFicha: hideOdoo ? null : lotFichaOf(c),
      fieldRegularizedAt: c.fieldRegularizedAt,
      fieldRegularizedByName: c.fieldRegularizedByName,
      missing: inspectMissing({
        ...c,
        photoCount: c.intakeOrigin === "odoo" ? c.photos.filter((p) => p.status !== PHOTO_STATUS_REJECTED).length : undefined,
      }),
      dataMissing: inspectDataMissing(c),
      suggested,
    };
  }

  async addGearMedia(
    depotId: string,
    outsiderId: string,
    files: { buffer: Buffer; originalname: string; size: number }[],
    user: AuthUser,
    ip?: string,
  ) {
    if (!depotId || !outsiderId) throw new BadRequestException("Indica el depósito y el equipo.");
    if (!files.length) throw new BadRequestException("Selecciona al menos una foto o un video.");
    if (files.length > 12) throw new BadRequestException("Se pueden cargar hasta 12 archivos a la vez.");
    const prepared = files.map((file) => {
      let mime = "";
      let kind: "photo" | "video" = "photo";
      try {
        mime = sniffInspectionPhotoMime(file.buffer);
      } catch {
        mime = "";
      }
      if (mime) {
        if (file.size > MAX_INSPECTION_PHOTO_BYTES) throw new BadRequestException("La foto supera el máximo de 8 MB.");
      } else {
        try {
          mime = sniffInspectionVideoMime(file.buffer);
          kind = "video";
        } catch (e) {
          throw new BadRequestException((e as Error).message);
        }
        if (file.size > MAX_INSPECTION_VIDEO_BYTES) throw new BadRequestException("El video supera el máximo de 40 MB.");
      }
      return { ...file, mime, kind };
    });
    return this.locks.withYardLock(depotId, async () => {
      const plan = await this.getYardPlan(depotId);
      const gear = plan.outsiders.find((item) => item.id === outsiderId);
      if (!gear) throw new NotFoundException("Ese equipo no está en el depósito.");
      const media = [...(gear.media || [])];
      if (media.length + prepared.length > 40) throw new BadRequestException("Ese equipo ya tiene el máximo de 40 archivos.");
      for (const file of prepared) {
        const id = randomUUID();
        const ext = extForInspectionMime(file.mime);
        const storageKey = `yard-gear/${depotId}/${gear.id}/${id}.${ext}`;
        await this.storage.put(storageKey, file.buffer, file.mime);
        media.push({
          id,
          kind: file.kind,
          storageKey,
          mime: file.mime,
          name: String(file.originalname || `archivo.${ext}`).replace(/[/\\]/g, "_").slice(0, 180),
        });
      }
      const value = {
        ...plan,
        outsiders: plan.outsiders.map((item) => (item.id === gear.id ? { ...item, media } : item)),
      };
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value },
        create: { key: yardPlanKey(depotId), value },
      });
      await this.audit.log({
        user,
        action: "cargar archivos",
        entity: "Yard",
        entityId: gear.code,
        after: { depotId, added: prepared.length },
        ip,
      });
      return normalizeYardPlan(value);
    });
  }

  async assignGearMedia(
    input: { depotId?: string; outsiderId?: string; mediaId?: string; slot?: number | null },
    user: AuthUser,
    ip?: string,
  ) {
    const depotId = input.depotId || "";
    const outsiderId = input.outsiderId || "";
    const mediaId = String(input.mediaId || "").trim();
    const rawSlot = input.slot;
    const clearing = rawSlot == null || rawSlot === ("" as unknown);
    const slot = clearing ? null : Number(rawSlot);
    if (!clearing && (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 8)) {
      throw new BadRequestException("Elige una casilla del 1 al 9.");
    }
    return this.locks.withYardLock(depotId, async () => {
      const plan = await this.getYardPlan(depotId);
      const gear = plan.outsiders.find((item) => item.id === outsiderId);
      if (!gear) throw new NotFoundException("Ese equipo no está en el depósito.");
      const current = (gear.media || []).find((item) => item.id === mediaId);
      if (!current) throw new NotFoundException("Ese archivo no está en el equipo.");
      if (!clearing && current.kind !== "photo") throw new BadRequestException("Solo una foto puede ocupar una casilla de la vista.");
      const media = (gear.media || []).map((item) => {
        if (item.id === current.id) {
          if (clearing) {
            const { slot: _slot, ...rest } = item;
            return rest;
          }
          return { ...item, slot: slot as number };
        }
        if (!clearing && item.slot === slot) {
          const { slot: _slot, ...rest } = item;
          return rest;
        }
        return item;
      });
      const value = {
        ...plan,
        outsiders: plan.outsiders.map((item) => (item.id === gear.id ? { ...item, media } : item)),
      };
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value },
        create: { key: yardPlanKey(depotId), value },
      });
      await this.audit.log({
        user,
        action: clearing ? "quitar foto de casilla" : "asignar foto",
        entity: "Yard",
        entityId: gear.code,
        after: { depotId, mediaId, slot },
        ip,
      });
      return normalizeYardPlan(value);
    });
  }

  async removeGearMedia(depotId: string, outsiderId: string, mediaId: string, user: AuthUser, ip?: string) {
    return this.locks.withYardLock(depotId, async () => {
      const plan = await this.getYardPlan(depotId);
      const gear = plan.outsiders.find((item) => item.id === outsiderId);
      if (!gear) throw new NotFoundException("Ese equipo no está en el depósito.");
      const current = (gear.media || []).find((item) => item.id === mediaId);
      if (!current) throw new NotFoundException("Ese archivo no está en el equipo.");
      await this.storage.delete(current.storageKey).catch(() => undefined);
      const media = (gear.media || []).filter((item) => item.id !== current.id);
      const value = {
        ...plan,
        outsiders: plan.outsiders.map((item) => (item.id === gear.id ? { ...item, ...(media.length ? { media } : {}) } : item)),
      };
      if (!media.length) {
        value.outsiders = value.outsiders.map((item) => {
          if (item.id !== gear.id) return item;
          const { media: _media, ...rest } = item;
          return rest;
        });
      }
      await this.prisma.appSetting.upsert({
        where: { key: yardPlanKey(depotId) },
        update: { value },
        create: { key: yardPlanKey(depotId), value },
      });
      await this.audit.log({ user, action: "quitar archivo", entity: "Yard", entityId: gear.code, after: { depotId, mediaId }, ip });
      return normalizeYardPlan(value);
    });
  }

  async openGearMedia(depotId: string, outsiderId: string, mediaId: string) {
    const plan = await this.getYardPlan(depotId);
    const gear = plan.outsiders.find((item) => item.id === outsiderId);
    const media = gear?.media?.find((item) => item.id === mediaId);
    if (!media || !media.storageKey.startsWith(`yard-gear/${depotId}/`)) throw new NotFoundException("Ese archivo no está.");
    const obj = await this.storage.get(media.storageKey);
    return { ...obj, contentType: media.mime || obj.contentType };
  }
}

function lotText(value: unknown) {
  if (value == null || value === "—") return "";
  return String(value);
}

function lotFichaOf(c: { year: number | null; color: string; odooSource: unknown }) {
  const src = c.odooSource && typeof c.odooSource === "object" && !Array.isArray(c.odooSource)
    ? (c.odooSource as Record<string, unknown>)
    : {};
  const date = lotText(src.numberingDate);
  const isoDate = date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
    || (() => {
      const dmy = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : "";
    })();
  return {
    zgroupCode: lotText(src.zgroupCode),
    internalRef: lotText(src.internalRef),
    lotCategory: lotText(src.lotCategory),
    classification: lotText(src.classification),
    lotCode: lotText(src.lotCode),
    numberingDate: isoDate,
    manufactureMonth: lotText(src.manufactureMonth),
    productTitle: lotText(src.productTitle),
    yearToken: lotText(src.yearToken) || (c.year ? String(c.year) : ""),
    color: c.color && c.color !== "—" ? c.color : lotText(src.color),
  };
}

function archiveMotive(kind?: string, comment?: string): string {
  const key = String(kind || "").trim().toLowerCase();
  if (key === "activo") return "Activo";
  if (key === "otro") {
    const note = String(comment || "").trim();
    if (note.length < 4) throw new BadRequestException("Si el motivo es Otro, el comentario es obligatorio.");
    return `Otro: ${note}`;
  }
  throw new BadRequestException("Elige el motivo: Activo u Otro.");
}

function toYardUnit(c: {
  iso: string;
  type: string;
  cat: string;
  manufacturer: string;
  depotId: string;
  lado: string | null;
  ruma: number | null;
  columna: number | null;
  nivel: number | null;
  bayHalf?: string | null;
  status: string;
  physicallyReceived: boolean;
}): YardUnit {
  return {
    iso: c.iso,
    type: c.type,
    cat: c.cat,
    manufacturer: c.manufacturer,
    depotId: c.depotId,
    lado: c.lado,
    ruma: c.ruma,
    columna: c.columna,
    nivel: c.nivel,
    bayHalf: c.bayHalf === "A" || c.bayHalf === "B" ? c.bayHalf : null,
    status: c.status,
    physicallyReceived: c.physicallyReceived,
  };
}

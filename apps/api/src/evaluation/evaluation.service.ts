import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import {
  CONCEPT_BY_LEGACY_FIELD,
  DEFAULT_EVAL_CONCEPTS,
  DEFAULT_EVAL_LEVELS,
  LEGACY_FIELD_BY_CONCEPT,
  parseEvalColor,
  slugEvalKey,
  type EvalSource,
} from "../domain/evaluation";

const LEGACY_KEYS = ["conditionFloor", "conditionRoof", "conditionDoors", "conditionPaint", "conditionWalls"] as const;

@Injectable()
export class EvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async ensureDefaults() {
    for (const row of DEFAULT_EVAL_LEVELS) {
      await this.prisma.evaluationLevel.upsert({
        where: { key: row.key },
        update: { label: row.label, sortOrder: row.sortOrder, color: row.color, system: true },
        create: { ...row, system: true, active: true },
      });
    }
    for (const row of DEFAULT_EVAL_CONCEPTS) {
      await this.prisma.evaluationConcept.upsert({
        where: { key: row.key },
        update: { label: row.label, sortOrder: row.sortOrder, system: true },
        create: { key: row.key, label: row.label, sortOrder: row.sortOrder, system: true, active: true },
      });
    }
  }

  presentCatalog() {
    return Promise.all([
      this.prisma.evaluationConcept.findMany({
        where: { archivedAt: null, active: true },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.evaluationLevel.findMany({
        where: { archivedAt: null, active: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]).then(([concepts, levels]) => ({
      evaluationConcepts: concepts.map((c) => ({ id: c.id, key: c.key, label: c.label, system: c.system })),
      evaluationLevels: levels.map((l) => ({
        id: l.id,
        key: l.key,
        label: l.label,
        color: l.color,
        sortOrder: l.sortOrder,
        system: l.system,
      })),
    }));
  }

  async adminConcepts() {
    return this.prisma.evaluationConcept.findMany({ orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }] });
  }

  async adminLevels() {
    return this.prisma.evaluationLevel.findMany({ orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }] });
  }

  async createConcept(labelRaw: string, user: AuthUser, ip?: string) {
    const label = String(labelRaw || "").trim();
    if (label.length < 2) throw new BadRequestException("Indica el nombre del concepto.");
    const key = slugEvalKey(label, `c_${Date.now()}`);
    const last = await this.prisma.evaluationConcept.aggregate({ _max: { sortOrder: true } });
    const row = await this.prisma.evaluationConcept.create({
      data: { key, label, sortOrder: (last._max.sortOrder || 0) + 10, system: false, active: true },
    });
    await this.audit.log({ user, action: "create", entity: "EvaluationConcept", entityId: row.id, after: { key, label }, ip });
    return row;
  }

  async updateConcept(
    id: string,
    body: { label?: string; sortOrder?: number; active?: boolean; archived?: boolean },
    user: AuthUser,
    ip?: string,
  ) {
    const current = await this.prisma.evaluationConcept.findUnique({ where: { id } });
    if (!current) throw new BadRequestException("Concepto no encontrado.");
    const data: Prisma.EvaluationConceptUpdateInput = {};
    if (body.label !== undefined) {
      const label = String(body.label).trim();
      if (label.length < 2) throw new BadRequestException("Indica el nombre del concepto.");
      data.label = label;
    }
    if (body.sortOrder !== undefined) data.sortOrder = Math.max(0, Math.round(Number(body.sortOrder) || 0));
    if (body.active !== undefined) data.active = !!body.active;
    if (body.archived === true) {
      if (current.system) throw new BadRequestException("Los conceptos de sistema no se archivan; puedes ocultarlos.");
      data.archivedAt = new Date();
      data.active = false;
    }
    if (body.archived === false) {
      data.archivedAt = null;
      data.active = true;
    }
    const row = await this.prisma.evaluationConcept.update({ where: { id }, data });
    await this.audit.log({ user, action: "update", entity: "EvaluationConcept", entityId: id, after: body as object, ip });
    return row;
  }

  async createLevel(body: { label?: string; color?: string }, user: AuthUser, ip?: string) {
    const label = String(body.label || "").trim();
    if (label.length < 2) throw new BadRequestException("Indica el nombre del nivel.");
    const key = slugEvalKey(label, `n_${Date.now()}`);
    const last = await this.prisma.evaluationLevel.aggregate({ _max: { sortOrder: true } });
    const row = await this.prisma.evaluationLevel.create({
      data: {
        key,
        label,
        color: parseEvalColor(body.color),
        sortOrder: (last._max.sortOrder || 0) + 10,
        system: false,
        active: true,
      },
    });
    await this.audit.log({ user, action: "create", entity: "EvaluationLevel", entityId: row.id, after: { key, label }, ip });
    return row;
  }

  async updateLevel(
    id: string,
    body: { label?: string; color?: string; sortOrder?: number; active?: boolean; archived?: boolean },
    user: AuthUser,
    ip?: string,
  ) {
    const current = await this.prisma.evaluationLevel.findUnique({ where: { id } });
    if (!current) throw new BadRequestException("Nivel no encontrado.");
    const data: Prisma.EvaluationLevelUpdateInput = {};
    if (body.label !== undefined) {
      const label = String(body.label).trim();
      if (label.length < 2) throw new BadRequestException("Indica el nombre del nivel.");
      data.label = label;
    }
    if (body.color !== undefined) data.color = parseEvalColor(body.color);
    if (body.sortOrder !== undefined) data.sortOrder = Math.max(0, Math.round(Number(body.sortOrder) || 0));
    if (body.active !== undefined) data.active = !!body.active;
    if (body.archived === true) {
      if (current.system) throw new BadRequestException("Los niveles de sistema no se archivan; puedes ocultarlos.");
      data.archivedAt = new Date();
      data.active = false;
    }
    if (body.archived === false) {
      data.archivedAt = null;
      data.active = true;
    }
    const row = await this.prisma.evaluationLevel.update({ where: { id }, data });
    await this.audit.log({ user, action: "update", entity: "EvaluationLevel", entityId: id, after: body as object, ip });
    return row;
  }

  async forUnit(iso: string) {
    const [ratings, history] = await Promise.all([
      this.prisma.containerRating.findMany({ where: { iso }, orderBy: { conceptLabel: "asc" } }),
      this.prisma.containerRatingHistory.findMany({ where: { iso }, orderBy: { createdAt: "desc" }, take: 80 }),
    ]);
    return {
      ratings: ratings.map((r) => ({
        id: r.id,
        conceptId: r.conceptId,
        conceptKey: r.conceptKey,
        conceptLabel: r.conceptLabel,
        levelId: r.levelId,
        levelKey: r.levelKey,
        levelLabel: r.levelLabel,
        note: r.note,
        source: r.source,
        setByName: r.setByName,
        setAt: r.setAt,
      })),
      ratingHistory: history.map((h) => ({
        id: h.id,
        conceptKey: h.conceptKey,
        conceptLabel: h.conceptLabel,
        fromLevelKey: h.fromLevelKey,
        fromLevelLabel: h.fromLevelLabel,
        toLevelKey: h.toLevelKey,
        toLevelLabel: h.toLevelLabel,
        reason: h.reason,
        source: h.source,
        setByName: h.setByName,
        createdAt: h.createdAt,
      })),
    };
  }

  async setRating(
    iso: string,
    body: { conceptId?: string; levelId?: string; reason?: string; note?: string; source?: EvalSource },
    user: AuthUser,
    ip?: string,
  ) {
    await this.ensureDefaults();
    const concept = await this.prisma.evaluationConcept.findUnique({ where: { id: String(body.conceptId || "") } });
    if (!concept || concept.archivedAt) throw new BadRequestException("Concepto de evaluación inválido.");
    const level = await this.prisma.evaluationLevel.findUnique({ where: { id: String(body.levelId || "") } });
    if (!level || level.archivedAt || !level.active) throw new BadRequestException("Nivel de evaluación inválido.");
    const source: EvalSource = body.source === "recepcion" || body.source === "catalogo" ? body.source : "patio";
    const reason = String(body.reason || "").trim();
    const existing = await this.prisma.containerRating.findUnique({
      where: { iso_conceptId: { iso, conceptId: concept.id } },
    });
    const changed = !existing || existing.levelId !== level.id;
    if (changed && source === "recepcion" && existing && reason.length < 4) {
      throw new BadRequestException("Indica el motivo de la corrección (mínimo 4 caracteres), con base en las fotos.");
    }
    const row = await this.prisma.containerRating.upsert({
      where: { iso_conceptId: { iso, conceptId: concept.id } },
      update: {
        levelId: level.id,
        levelKey: level.key,
        levelLabel: level.label,
        conceptKey: concept.key,
        conceptLabel: concept.label,
        note: String(body.note || "").trim(),
        source,
        setById: user.id,
        setByName: user.name,
        setAt: new Date(),
      },
      create: {
        iso,
        conceptId: concept.id,
        conceptKey: concept.key,
        conceptLabel: concept.label,
        levelId: level.id,
        levelKey: level.key,
        levelLabel: level.label,
        note: String(body.note || "").trim(),
        source,
        setById: user.id,
        setByName: user.name,
      },
    });
    if (changed) {
      await this.prisma.containerRatingHistory.create({
        data: {
          iso,
          conceptId: concept.id,
          conceptKey: concept.key,
          conceptLabel: concept.label,
          fromLevelKey: existing?.levelKey || null,
          fromLevelLabel: existing?.levelLabel || null,
          toLevelKey: level.key,
          toLevelLabel: level.label,
          reason: reason || (source === "patio" ? "Evaluación de patio" : ""),
          source,
          setById: user.id,
          setByName: user.name,
        },
      });
    }
    const legacyField = LEGACY_FIELD_BY_CONCEPT[concept.key];
    if (legacyField) {
      await this.prisma.container.update({
        where: { iso },
        data: { [legacyField]: level.key },
      });
    }
    await this.audit.log({
      user,
      action: changed && existing ? "correct_rating" : "set_rating",
      entity: "ContainerRating",
      entityId: iso,
      after: { concept: concept.key, level: level.key, source, reason },
      ip,
    });
    return row;
  }

  async syncLegacyFields(
    iso: string,
    body: Partial<Record<"conditionFloor" | "conditionRoof" | "conditionDoors" | "conditionPaint" | "conditionWalls", string | null | undefined>>,
    user: AuthUser,
    ip?: string,
    source: EvalSource = "patio",
  ) {
    await this.ensureDefaults();
    const [concepts, levels] = await Promise.all([
      this.prisma.evaluationConcept.findMany({ where: { archivedAt: null } }),
      this.prisma.evaluationLevel.findMany({ where: { archivedAt: null, active: true } }),
    ]);
    const byKey = Object.fromEntries(concepts.map((c) => [c.key, c]));
    const levelByKey = Object.fromEntries(levels.map((l) => [l.key, l]));
    for (const field of LEGACY_KEYS) {
      if (body[field] === undefined) continue;
      const conceptKey = CONCEPT_BY_LEGACY_FIELD[field];
      const concept = byKey[conceptKey];
      const raw = String(body[field] || "").trim().toLowerCase();
      if (!concept) continue;
      if (!raw) continue;
      const level = levelByKey[raw];
      if (!level) continue;
      await this.setRating(iso, { conceptId: concept.id, levelId: level.id, source, reason: "" }, user, ip);
    }
  }

  async importLegacyForUnit(iso: string, unit: {
    conditionFloor?: string | null;
    conditionRoof?: string | null;
    conditionDoors?: string | null;
    conditionPaint?: string | null;
    conditionWalls?: string | null;
  }) {
    const existing = await this.prisma.containerRating.count({ where: { iso } });
    if (existing) return;
    const hasLegacy = LEGACY_KEYS.some((k) => unit[k]);
    if (!hasLegacy) return;
    await this.ensureDefaults();
    const [concepts, levels] = await Promise.all([
      this.prisma.evaluationConcept.findMany({ where: { archivedAt: null } }),
      this.prisma.evaluationLevel.findMany({ where: { archivedAt: null } }),
    ]);
    const byKey = Object.fromEntries(concepts.map((c) => [c.key, c]));
    const levelByKey = Object.fromEntries(levels.map((l) => [l.key, l]));
    for (const field of LEGACY_KEYS) {
      const raw = String(unit[field] || "").trim().toLowerCase();
      const concept = byKey[CONCEPT_BY_LEGACY_FIELD[field]];
      const level = levelByKey[raw];
      if (!concept || !level) continue;
      await this.prisma.containerRating.upsert({
        where: { iso_conceptId: { iso, conceptId: concept.id } },
        update: {},
        create: {
          iso,
          conceptId: concept.id,
          conceptKey: concept.key,
          conceptLabel: concept.label,
          levelId: level.id,
          levelKey: level.key,
          levelLabel: level.label,
          source: "patio",
          setByName: "Migración",
        },
      });
    }
  }
}

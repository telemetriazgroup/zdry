import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  backfillDocsFromCandidate,
  diffsFromLotWrite,
  fieldEvolution,
  isosForEvent,
  noteFromEvent,
  sameSnapshotData,
  snapshotFromEvent,
  type DocDraft,
} from "../domain/odoo-expediente";
import { normalizeIncomingEvent, type IncomingOdooEvent } from "../domain/odoo-event";
import { inspectOdooIso, type OdooOwnedField } from "../domain/odoo-lot-map";
import { presentOdooDocument } from "../domain/odoo-doc-present";

const SERIAL_DOC_KINDS = new Set(["picking_in", "picking_out", "transfer", "repair", "sale"]);

function scopeDocToIso(kind: string, data: Record<string, unknown>, iso: string): Record<string, unknown> | null {
  const isos = Array.isArray(data.isos) ? data.isos.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (SERIAL_DOC_KINDS.has(kind) && isos.length && !isos.includes(iso)) return null;
  if (!Array.isArray(data.pickings)) return data;
  return {
    ...data,
    pickings: data.pickings.filter((p) => {
      const row = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      const list = Array.isArray(row.isos) ? row.isos.map((x) => String(x || "").trim()).filter(Boolean) : [];
      return !list.length || list.includes(iso);
    }),
  };
}

function syntheticId(name: string): number {
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return h === 0 ? -1 : -Math.abs(h);
}

function parseDate(raw: string | null | undefined) {
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class ExpedienteStore {
  constructor(private readonly prisma: PrismaService) {}

  async present(isoNormalized: string) {
    const iso = inspectOdooIso(isoNormalized).isoNormalized || isoNormalized;
    const [timeline, docs, notes] = await Promise.all([
      this.prisma.unitTimeline.findMany({ where: { isoNormalized: iso }, orderBy: { createdAt: "desc" }, take: 200 }),
      this.prisma.odooDocSnapshot.findMany({ where: { isoNormalized: iso }, orderBy: [{ kind: "asc" }, { name: "asc" }, { version: "desc" }] }),
      this.prisma.unitNote.findMany({ where: { isoNormalized: iso }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 200 }),
    ]);
    const grouped = new Map<string, typeof docs>();
    for (const d of docs) {
      const key = `${d.kind}:${d.name}`;
      const list = grouped.get(key) || [];
      list.push(d);
      grouped.set(key, list);
    }
    return {
      isoNormalized: iso,
      timeline,
      evolution: fieldEvolution(timeline),
      documents: [...grouped.values()].map((versions) => {
        const current = versions[0];
        const data = current.data && typeof current.data === "object" && !Array.isArray(current.data)
          ? (current.data as Record<string, unknown>)
          : {};
        const scoped = scopeDocToIso(current.kind, data, iso);
        if (!scoped) return null;
        return {
          current,
          versions,
          view: presentOdooDocument({ kind: current.kind, name: current.name, summary: current.summary, data: scoped }),
        };
      }).filter((d): d is NonNullable<typeof d> => Boolean(d)),
      notes,
    };
  }

  async importOdooNotes(
    isoNormalized: string,
    notes: Array<{ id: number; body: string; author: string | null; date: string | null }>,
    meta?: { candidateId?: string | null; containerIso?: string | null },
  ) {
    const iso = inspectOdooIso(isoNormalized).isoNormalized || isoNormalized;
    let added = 0;
    for (const n of notes || []) {
      const body = String(n.body || "").trim();
      if (!n.id || !body) continue;
      try {
        await this.prisma.unitNote.create({
          data: {
            isoNormalized: iso,
            candidateId: meta?.candidateId || null,
            containerIso: meta?.containerIso || null,
            source: "odoo",
            odooMessageId: n.id,
            author: n.author,
            body: body.slice(0, 4000),
            occurredAt: parseDate(n.date),
          },
        });
        added += 1;
      } catch {
        /* unique odooMessageId */
      }
    }
    return added;
  }

  async addZdryNote(isoNormalized: string, body: string, author: string | null, meta?: { candidateId?: string | null; containerIso?: string | null }) {
    const iso = inspectOdooIso(isoNormalized).isoNormalized || isoNormalized;
    const text = String(body || "").trim();
    if (!text) return null;
    return this.prisma.unitNote.create({
      data: {
        isoNormalized: iso,
        candidateId: meta?.candidateId || null,
        containerIso: meta?.containerIso || null,
        source: "zdry",
        author,
        body: text.slice(0, 4000),
        occurredAt: new Date(),
      },
    });
  }

  async retainDocs(isoNormalized: string, kinds: string[], names: string[]) {
    const iso = inspectOdooIso(isoNormalized).isoNormalized || isoNormalized;
    await this.prisma.odooDocSnapshot.deleteMany({
      where: {
        isoNormalized: iso,
        kind: { in: kinds },
        ...(names.length ? { name: { notIn: names } } : {}),
      },
    });
  }

  async upsertShared(
    isos: string[],
    draft: DocDraft,
    meta?: { candidateId?: string | null; containerIso?: string | null },
  ) {
    for (const iso of [...new Set(isos.map((s) => inspectOdooIso(s).isoNormalized || s).filter(Boolean))]) {
      await this.upsertDoc(iso, draft, meta);
    }
  }

  async latestMoUnitCost(isoNormalized: string): Promise<number | null> {
    const iso = inspectOdooIso(isoNormalized).isoNormalized || isoNormalized;
    const row = await this.prisma.odooDocSnapshot.findFirst({
      where: { isoNormalized: iso, kind: "mo" },
      orderBy: { version: "desc" },
    });
    const data = row?.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
    const n = Number(data.unitCost ?? data.total);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async hasOdooNotes(isoNormalized: string) {
    const iso = inspectOdooIso(isoNormalized).isoNormalized || isoNormalized;
    const n = await this.prisma.unitNote.count({ where: { isoNormalized: iso, source: "odoo" } });
    return n > 0;
  }

  async backfillCandidate(cand: {
    id: string;
    isoNormalized: string;
    containerIso?: string | null;
    odooPoId?: number | null;
    odooPoName?: string | null;
    odooVendorName?: string | null;
    odooBillName?: string | null;
    odooUnitPrice?: unknown;
    odooPickingName?: string | null;
    odooMoName?: string | null;
    odooIntakeKind?: string | null;
    odooSourceProductCode?: string | null;
    odooSourceLotId?: number | null;
  }) {
    const iso = inspectOdooIso(cand.isoNormalized).isoNormalized || cand.isoNormalized;
    for (const draft of backfillDocsFromCandidate(cand)) {
      const exists = await this.prisma.odooDocSnapshot.findFirst({
        where: { isoNormalized: iso, kind: draft.kind, name: draft.name },
        select: { id: true },
      });
      if (exists) continue;
      await this.upsertDoc(iso, draft, { candidateId: cand.id, containerIso: cand.containerIso });
    }
  }

  async appendEvent(
    raw: IncomingOdooEvent,
    ctx: {
      candidateId?: string | null;
      containerIso?: string | null;
      current?: Partial<Record<OdooOwnedField, unknown>>;
      applied?: Partial<Record<OdooOwnedField, unknown>>;
      conflicts?: Array<{ field: string; localValue: unknown; odooValue: unknown }>;
      odooEventId?: number | null;
    },
  ) {
    const ev = normalizeIncomingEvent(raw);
    if (!ev) return;
    let isos = isosForEvent(ev);
    if (!isos.length) isos = await this.isosFromKnownDocs(ev);
    if (!isos.length) return;
    const source = ev.origin;
    const applied = ctx.applied || {};
    const conflicts = ctx.conflicts || [];

    if (ev.event === "lot_write") {
      const diffs = diffsFromLotWrite(ctx.current, ev.payload, applied, conflicts);
      for (const iso of isos) {
        for (const d of diffs) {
          await this.prisma.unitTimeline.create({
            data: {
              isoNormalized: iso,
              candidateId: ctx.candidateId || null,
              containerIso: ctx.containerIso || null,
              field: d.field,
              before: d.before,
              after: d.after,
              source,
              event: ev.event,
              odooEventId: ctx.odooEventId ?? ev.odooEventId,
              applied: d.applied,
            },
          });
        }
      }
    }

    const snap = snapshotFromEvent(ev);
    if (snap) {
      for (const iso of isos) {
        await this.upsertDoc(iso, snap, {
          candidateId: ctx.candidateId,
          containerIso: ctx.containerIso,
          sourceWriteDate: ev.sourceWriteDate,
        });
      }
    }

    const note = noteFromEvent(ev);
    if (note) {
      for (const iso of isos) {
        try {
          await this.prisma.unitNote.create({
            data: {
              isoNormalized: iso,
              candidateId: ctx.candidateId || null,
              containerIso: ctx.containerIso || null,
              source: "odoo",
              odooMessageId: note.odooMessageId,
              author: note.author,
              body: note.body,
              occurredAt: parseDate(note.occurredAt),
            },
          });
        } catch {
          /* unique odooMessageId */
        }
      }
    }
  }

  private async isosFromKnownDocs(ev: { event: string; payload: Record<string, unknown> }) {
    const p = ev.payload;
    const names: string[] = [];
    if (ev.event === "po_confirm") {
      const n = String(p.po_name || p.name || "").trim();
      if (n) names.push(n);
    }
    if (ev.event === "bill_posted") {
      const pos = Array.isArray(p.po_names) ? p.po_names.map(String) : [];
      names.push(...pos.filter(Boolean));
      const bill = String(p.bill_name || p.name || "").trim();
      if (bill) {
        const byBill = await this.prisma.odooLotCandidate.findMany({
          where: { odooBillName: bill },
          select: { isoNormalized: true },
        });
        if (byBill.length) return [...new Set(byBill.map((c) => c.isoNormalized))];
      }
    }
    if (ev.event === "mo_done") {
      const n = String(p.mo_name || p.name || "").trim();
      if (n) {
        const byMo = await this.prisma.odooLotCandidate.findMany({
          where: { odooMoName: n },
          select: { isoNormalized: true },
        });
        if (byMo.length) return [...new Set(byMo.map((c) => c.isoNormalized))];
      }
    }
    if (!names.length) return [];
    const rows = await this.prisma.odooLotCandidate.findMany({
      where: { odooPoName: { in: names } },
      select: { isoNormalized: true },
    });
    return [...new Set(rows.map((c) => c.isoNormalized))];
  }

  private async upsertDoc(
    isoNormalized: string,
    draft: DocDraft,
    meta?: { candidateId?: string | null; containerIso?: string | null; sourceWriteDate?: string | null },
  ) {
    const iso = inspectOdooIso(isoNormalized).isoNormalized || isoNormalized;
    const odooId = draft.odooId || syntheticId(draft.name);
    const last =
      (await this.prisma.odooDocSnapshot.findFirst({
        where: { isoNormalized: iso, kind: draft.kind, odooId },
        orderBy: { version: "desc" },
      })) ||
      (await this.prisma.odooDocSnapshot.findFirst({
        where: { isoNormalized: iso, kind: draft.kind, name: draft.name },
        orderBy: { version: "desc" },
      }));
    const data = draft.data as Prisma.InputJsonValue;
    if (last && sameSnapshotData(last.data as Record<string, unknown>, draft.data)) return last;
    return this.prisma.odooDocSnapshot.create({
      data: {
        isoNormalized: iso,
        candidateId: meta?.candidateId || last?.candidateId || null,
        containerIso: meta?.containerIso || last?.containerIso || null,
        kind: draft.kind,
        odooModel: draft.odooModel,
        odooId,
        version: (last?.version || 0) + 1,
        name: draft.name,
        summary: draft.summary,
        data,
        sourceWriteDate: parseDate(meta?.sourceWriteDate),
      },
    });
  }
}

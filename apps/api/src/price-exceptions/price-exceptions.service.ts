import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import { isPendingValuation } from "../domain/odoo-reconcile";
import { exceptionPriceError } from "../domain/price-exception";
import { isMediaApproved } from "../domain/catalog-media";

function money(n: Prisma.Decimal | number | null | undefined) {
  return Math.round(Number(n) || 0);
}

function present(row: {
  id: string;
  iso: string;
  vendorId: string;
  vendorName: string;
  clientName: string;
  clientCompany: string;
  ruc: string;
  reason: string;
  requestedPrice: Prisma.Decimal;
  approvedPrice: Prisma.Decimal | null;
  priceList: Prisma.Decimal;
  priceMin: Prisma.Decimal;
  status: string;
  reviewNote: string;
  reviewedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    iso: row.iso,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    clientName: row.clientName,
    clientCompany: row.clientCompany,
    ruc: row.ruc,
    reason: row.reason,
    requestedPrice: money(row.requestedPrice),
    approvedPrice: row.approvedPrice == null ? null : money(row.approvedPrice),
    priceList: money(row.priceList),
    priceMin: money(row.priceMin),
    status: row.status,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PriceExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private seesAll(user: AuthUser) {
    return user.role === "superadmin" || user.role === "admin";
  }

  async list(user: AuthUser) {
    const rows = await this.prisma.priceException.findMany({
      where: this.seesAll(user) ? {} : { vendorId: user.id },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    return rows.map(present);
  }

  async create(
    body: { iso?: string; requestedPrice?: number; clientName?: string; clientCompany?: string; ruc?: string; reason?: string },
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role !== "vendedor" && user.role !== "superadmin") {
      throw new ForbiddenException("Solo el comercial registra la solicitud del cliente.");
    }
    const iso = String(body.iso || "").trim().toUpperCase();
    const clientName = String(body.clientName || "").trim().slice(0, 160);
    const reason = String(body.reason || "").trim().slice(0, 500);
    const requested = Number(body.requestedPrice);
    if (!iso) throw new BadRequestException("Indica la unidad.");
    if (!clientName) throw new BadRequestException("Indica el cliente que pide el precio.");
    if (reason.length < 8) throw new BadRequestException("Explica por qué el cliente pide por debajo del mínimo.");
    const unit = await this.prisma.container.findUnique({ where: { iso } });
    if (!unit || unit.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    if (!isMediaApproved(unit.mediaStatus) || isPendingValuation(unit) || !unit.physicallyReceived) {
      throw new BadRequestException("Solo se pide excepción sobre una unidad publicada.");
    }
    if (unit.status !== "Disponible" && unit.status !== "Reservado") {
      throw new BadRequestException("Esa unidad no está disponible para la venta.");
    }
    const priceMin = money(unit.priceMin);
    const priceList = money(unit.priceList);
    const error = exceptionPriceError(requested, priceMin);
    if (error) throw new BadRequestException(error);
    const open = await this.prisma.priceException.findFirst({
      where: { iso, vendorId: user.id, status: "pendiente", clientName },
    });
    if (open) throw new BadRequestException("Ya hay una solicitud pendiente de este cliente para esa unidad.");
    const row = await this.prisma.priceException.create({
      data: {
        iso,
        vendorId: user.id,
        vendorName: user.name,
        clientName,
        clientCompany: String(body.clientCompany || "").trim().slice(0, 160),
        ruc: String(body.ruc || "").replace(/\D/g, "").slice(0, 11),
        reason,
        requestedPrice: requested,
        priceList,
        priceMin,
      },
    });
    await this.audit.log({
      user,
      action: "price_exception_request",
      entity: "PriceException",
      entityId: row.id,
      after: { iso, requested, priceMin, clientName },
      ip,
    });
    return present(row);
  }

  async approve(id: string, body: { approvedPrice?: number; note?: string }, user: AuthUser, ip?: string) {
    const row = await this.prisma.priceException.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Solicitud no encontrada.");
    if (row.status !== "pendiente") throw new BadRequestException("Esa solicitud ya fue evaluada.");
    const approved = body.approvedPrice == null ? money(row.requestedPrice) : Number(body.approvedPrice);
    const error = exceptionPriceError(approved, money(row.priceMin));
    if (error) throw new BadRequestException(error);
    const note = String(body.note || "").trim().slice(0, 500);
    const updated = await this.prisma.priceException.update({
      where: { id },
      data: {
        status: "aprobada",
        approvedPrice: approved,
        reviewNote: note,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });
    const detail = `Excepción de precio aprobada por ${user.name}: ${row.clientName} puede comprar ${row.iso} a $${approved}. El mínimo de la regla es $${money(row.priceMin)} y la lista $${money(row.priceList)}.${note ? ` ${note}` : ""}`;
    await this.prisma.containerHistory.create({
      data: { iso: row.iso, type: "Excepción de precio", detail },
    });
    await this.audit.log({
      user,
      action: "price_exception_approve",
      entity: "PriceException",
      entityId: id,
      after: { iso: row.iso, approved, priceMin: money(row.priceMin) },
      ip,
    });
    return present(updated);
  }

  async reject(id: string, body: { note?: string }, user: AuthUser, ip?: string) {
    const row = await this.prisma.priceException.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Solicitud no encontrada.");
    if (row.status !== "pendiente") throw new BadRequestException("Esa solicitud ya fue evaluada.");
    const note = String(body.note || "").trim().slice(0, 500);
    if (note.length < 4) throw new BadRequestException("Indica por qué se rechaza.");
    const updated = await this.prisma.priceException.update({
      where: { id },
      data: { status: "rechazada", reviewNote: note, reviewedById: user.id, reviewedAt: new Date() },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: row.iso,
        type: "Excepción de precio",
        detail: `Solicitud de ${row.vendorName} para ${row.clientName} a $${money(row.requestedPrice)} rechazada por ${user.name}. ${note}`,
      },
    });
    await this.audit.log({
      user,
      action: "price_exception_reject",
      entity: "PriceException",
      entityId: id,
      after: { iso: row.iso, note },
      ip,
    });
    return present(updated);
  }
}

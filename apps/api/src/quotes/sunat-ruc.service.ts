import { HttpException, HttpStatus, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { AuthUser } from "../auth/auth.types";
import {
  RUC_LOOKUP_MAX,
  mapSunatRuc,
  nextRucLookupState,
  normalizeRuc,
  rucLookupGate,
  type MappedSunatRuc,
} from "../domain/ruc-sunat";

@Injectable()
export class SunatRucService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
  ) {}

  lookupStatus(customer: {
    rucLookupAttempts: number;
    rucLookupLockedUntil: Date | null;
    rucValidatedAt: Date | null;
    rucDni: string;
  }) {
    const gate = rucLookupGate({
      attempts: customer.rucLookupAttempts,
      lockedUntil: customer.rucLookupLockedUntil,
    });
    return {
      remaining: gate.remaining,
      max: RUC_LOOKUP_MAX,
      lockedUntil: gate.ok ? null : gate.lockedUntil.toISOString(),
      validated: Boolean(customer.rucValidatedAt && normalizeRuc(customer.rucDni)),
    };
  }

  async lookupForCustomer(user: AuthUser, rawRuc: string): Promise<{ sunat: MappedSunatRuc; remaining: number }> {
    if (user.role !== "cliente" || !user.customerId) {
      throw new UnprocessableEntityException("Solo una cuenta de cliente valida el RUC para cotizar.");
    }
    const ruc = normalizeRuc(rawRuc);
    if (!ruc) throw new UnprocessableEntityException("Ingresa un RUC peruano de 11 dígitos.");

    const customer = await this.prisma.customer.findUnique({ where: { id: user.customerId } });
    if (!customer) throw new UnprocessableEntityException("No hay empresa asociada a esta cuenta.");

    const gate = rucLookupGate({
      attempts: customer.rucLookupAttempts,
      lockedUntil: customer.rucLookupLockedUntil,
    });
    if (!gate.ok) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { rucLookupLockedUntil: gate.lockedUntil, rucLookupAttempts: RUC_LOOKUP_MAX },
      });
      throw new HttpException(
        { message: gate.message, code: "ruc_lookup_locked", lockedUntil: gate.retryAt, remaining: 0 },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const next = nextRucLookupState({
      attempts: customer.rucLookupAttempts,
      lockedUntil: customer.rucLookupLockedUntil,
    });

    let mapped: MappedSunatRuc | null = null;
    let sunatError = "";
    try {
      const raw = (await this.odoo.callKw("res.partner", "zdry_lookup_sunat", [ruc])) as Record<string, unknown>;
      mapped = mapSunatRuc(raw, ruc);
    } catch (e) {
      sunatError = (e as Error).message || "No se pudo consultar SUNAT.";
    }

    const infra = /doesn'?t have (the )?method|has no attribute|no está instalado|not installed|Object res\.partner/i.test(
      sunatError,
    );
    if (!infra) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          rucLookupAttempts: next.attempts,
          rucLookupLockedUntil: next.lockedUntil,
        },
      });
    }

    if (!mapped) {
      throw new UnprocessableEntityException(sunatError || "SUNAT no devolvió datos para ese RUC.");
    }

    const other = await this.prisma.customer.findFirst({
      where: { rucDni: mapped.ruc, NOT: { id: customer.id } },
    });
    if (other) {
      throw new UnprocessableEntityException("Ese RUC ya está asociado a otra cuenta ZDRY.");
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        rucDni: mapped.ruc,
        companyName: mapped.companyName,
        street: mapped.street,
        district: mapped.district,
        province: mapped.province,
        sunatState: mapped.sunatState,
        sunatCondition: mapped.sunatCondition,
        rucValidatedAt: new Date(),
      },
    });

    const remainingGate = rucLookupGate({ attempts: next.attempts, lockedUntil: next.lockedUntil });
    return { sunat: mapped, remaining: remainingGate.remaining };
  }
}

import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "async_hooks";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import { inferOdooModes, normalizeOdooModes, ODOO_MODES_KEY, OdooConfig, OdooModeName } from "../domain/odoo-config";
import {
  ODOO_CUTOVER_KEY,
  decryptOdooKey,
  encryptOdooKey,
  odooGateRequired,
  odooLoginMatches,
  odooProbeModel,
  redactOdooSecret,
  sameOdooOrigin,
} from "../domain/odoo-link";
import { OdooClient } from "./odoo.client";

const LINK_REQUIRED = "Falta tu clave API de Odoo. En Preferencias de Odoo crea una clave y pruébala en ZDRY.";

@Injectable()
export class OdooLinkService {
  readonly actors = new AsyncLocalStorage<AuthUser>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => OdooClient)) private readonly odoo: OdooClient,
  ) {}

  currentActor(): AuthUser | undefined {
    return this.actors.getStore();
  }

  runAs<T>(user: AuthUser, fn: () => Promise<T>): Promise<T> {
    return this.actors.run(user, fn);
  }

  async statusFor(user: AuthUser) {
    const cfg = await this.odoo.readConfig();
    const link = await this.prisma.userOdooLink.findUnique({ where: { userId: user.id } });
    const required = odooGateRequired(user.role);
    const originOk = !!link && sameOdooOrigin(cfg, { url: link.targetUrl, db: link.targetDb });
    const active = !!link && link.status === "active" && originOk && !link.bypass;
    const open = !required || !!link?.bypass || active;
    const cutover = await this.cutoverState();
    return {
      required,
      open,
      bypass: !!link?.bypass,
      status: link?.bypass ? "exempt" : !link || link.status === "none" || !originOk ? "none" : link.status,
      mode: await this.activeMode(),
      email: user.email,
      odooName: link?.odooName || "",
      companyName: link?.companyName || "",
      testedAt: link?.testedAt?.toISOString() || null,
      lastError: link?.lastError || "",
      apiKeySet: Boolean(link?.apiKeyEnc),
      cutoverPending: !!cutover?.pending,
      cutoverAt: cutover?.at || null,
    };
  }

  async test(user: AuthUser, body: { email?: string; apiKey?: string }) {
    const email = String(body.email || "").trim();
    const apiKey = String(body.apiKey || "").trim();
    if (!odooLoginMatches(user.email, email)) {
      throw new BadRequestException("El correo debe ser el de tu usuario en ZDRY. Ese mismo correo tiene que ser el login en Odoo.");
    }
    if (!apiKey) throw new BadRequestException("Pega la clave API que generaste en Odoo.");
    const principal = await this.odoo.readConfig();
    if (!principal.url || !principal.db) {
      throw new BadRequestException("El superadmin todavía no definió la URL y la base de Odoo.");
    }
    const personal: OdooConfig = { ...principal, user: email, apiKey };
    try {
      const uid = await this.odoo.authenticate(personal);
      const rows = (await this.odoo.executeKw(personal, uid, "res.users", "read", [[uid], ["name", "login", "company_id"]])) as Array<{
        name?: string;
        login?: string;
        company_id?: [number, string] | false;
      }>;
      const me = rows?.[0];
      const login = String(me?.login || "");
      if (!odooLoginMatches(user.email, login)) {
        throw new Error("La clave abrió otra cuenta de Odoo. Tiene que ser el mismo correo de ZDRY.");
      }
      await this.assertCompany(personal, principal, me?.company_id);
      const model = odooProbeModel(user.role);
      await this.odoo.executeKw(personal, uid, model, "search_read", [[]], { fields: ["id"], limit: 1 });
      const company = Array.isArray(me?.company_id) ? me.company_id : null;
      await this.prisma.userOdooLink.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          odooLogin: login,
          odooUid: uid,
          odooName: String(me?.name || ""),
          companyId: company ? company[0] : null,
          companyName: company ? String(company[1] || "") : "",
          apiKeyEnc: encryptOdooKey(apiKey),
          status: "active",
          testedAt: new Date(),
          lastError: "",
          targetUrl: principal.url,
          targetDb: principal.db,
        },
        update: {
          odooLogin: login,
          odooUid: uid,
          odooName: String(me?.name || ""),
          companyId: company ? company[0] : null,
          companyName: company ? String(company[1] || "") : "",
          apiKeyEnc: encryptOdooKey(apiKey),
          status: "active",
          testedAt: new Date(),
          lastError: "",
          targetUrl: principal.url,
          targetDb: principal.db,
        },
      });
      await this.audit.log({
        user,
        action: "odoo_link_test",
        entity: "UserOdooLink",
        entityId: user.id,
        after: { ok: true, uid, company: company ? company[1] : null },
      });
      return this.statusFor(user);
    } catch (e) {
      const message = redactOdooSecret((e as Error).message || "Odoo rechazó la clave.", apiKey);
      await this.prisma.userOdooLink.upsert({
        where: { userId: user.id },
        create: { userId: user.id, status: "failed", lastError: message, targetUrl: principal.url, targetDb: principal.db },
        update: {
          status: "failed",
          lastError: message,
          testedAt: new Date(),
          targetUrl: principal.url,
          targetDb: principal.db,
          apiKeyEnc: "",
        },
      });
      throw new BadRequestException(message);
    }
  }

  async listForAdmin() {
    const cfg = await this.odoo.readConfig();
    const users = await this.prisma.user.findMany({
      where: { role: { in: ["admin", "vendedor", "coordinador"] }, active: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      include: { odooLink: true },
    });
    return users.map((u) => {
      const link = u.odooLink;
      const originOk = !!link && sameOdooOrigin(cfg, { url: link.targetUrl, db: link.targetDb });
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        bypass: !!link?.bypass,
        status: link?.bypass ? "exempt" : !link || !originOk ? "none" : link.status,
        odooName: link?.odooName || "",
        testedAt: link?.testedAt?.toISOString() || null,
        lastError: link?.lastError || "",
      };
    });
  }

  async setBypass(actor: AuthUser, userId: string, bypass: boolean, ip?: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || !odooGateRequired(target.role)) {
      throw new BadRequestException("Solo se exime a comercial, despacho o administrador.");
    }
    await this.prisma.userOdooLink.upsert({
      where: { userId },
      create: {
        userId,
        bypass,
        bypassById: bypass ? actor.id : null,
        bypassByName: bypass ? actor.name : "",
        bypassAt: bypass ? new Date() : null,
        status: "none",
      },
      update: {
        bypass,
        bypassById: bypass ? actor.id : null,
        bypassByName: bypass ? actor.name : "",
        bypassAt: bypass ? new Date() : null,
      },
    });
    await this.audit.log({
      user: actor,
      action: bypass ? "odoo_link_bypass" : "odoo_link_bypass_off",
      entity: "UserOdooLink",
      entityId: userId,
      after: {
        bypass,
        target: target.email,
        note: bypass
          ? "Esta persona opera con la cuenta principal. Odoo no verá su nombre."
          : "Se quitó la exención. La próxima acción de Odoo exige su clave.",
      },
      ip,
    });
    return this.listForAdmin();
  }

  /** Cuenta con la que sale la llamada del usuario que está en la petición. */
  async resolveActing(principal: OdooConfig): Promise<{ cfg: OdooConfig; via: "principal" | "user" | "bypass" }> {
    const user = this.currentActor();
    if (!user || !odooGateRequired(user.role)) return { cfg: principal, via: "principal" };
    const link = await this.prisma.userOdooLink.findUnique({ where: { userId: user.id } });
    if (link?.bypass) return { cfg: principal, via: "bypass" };
    const originOk = !!link && link.status === "active" && sameOdooOrigin(principal, { url: link.targetUrl, db: link.targetDb });
    if (!originOk || !link?.apiKeyEnc) {
      throw new ForbiddenException(LINK_REQUIRED);
    }
    let apiKey = "";
    try {
      apiKey = decryptOdooKey(link.apiKeyEnc);
    } catch {
      throw new ForbiddenException("No se pudo leer tu clave API. Vuelve a probarla.");
    }
    return {
      cfg: { ...principal, user: link.odooLogin || user.email, apiKey },
      via: "user",
    };
  }

  async markFailed(userId: string, message: string) {
    await this.prisma.userOdooLink.updateMany({
      where: { userId, bypass: false },
      data: { status: "failed", lastError: redactOdooSecret(message).slice(0, 400) },
    });
  }

  async noteBypass(user: AuthUser, model: string, detail: string) {
    await this.audit.log({
      user,
      action: "odoo_as_principal",
      entity: model,
      after: { note: "Odoo no verá el nombre de este usuario; opera la cuenta principal.", detail: detail.slice(0, 180) },
    });
  }

  async viewerLocked(): Promise<boolean> {
    const user = this.currentActor();
    if (!user || !odooGateRequired(user.role)) return false;
    const st = await this.statusFor(user);
    return !st.open;
  }

  async onOriginChange(actor: AuthUser, from: { url: string; db: string }, to: { url: string; db: string }) {
    await this.prisma.userOdooLink.updateMany({
      data: {
        status: "none",
        odooUid: null,
        lastError: "La URL o la base de Odoo cambiaron. Crea la clave en el servidor nuevo y vuelve a probar.",
        targetUrl: "",
        targetDb: "",
      },
    });
    await this.prisma.odooSyncJob.updateMany({
      where: { status: { in: ["pending", "running", "error"] } },
      data: { status: "dropped", lastError: "Entorno anterior. No se reintenta en la base nueva." },
    });
    await this.prisma.container.updateMany({
      data: { odooLotId: null, odooPoId: null, odooSourceLotId: null },
    });
    await this.prisma.quote.updateMany({
      data: { odooSaleId: null, odooPartnerId: null },
    });
    await this.prisma.customer.updateMany({
      data: { odooPartnerId: null },
    });
    await this.prisma.odooLotCandidate.updateMany({
      data: { odooSyncStatus: "cutover", odooSyncError: "El origen de Odoo cambió. Hay que volver a bajar por ISO." },
    });
    const value = {
      pending: true,
      at: new Date().toISOString(),
      fromUrl: from.url,
      fromDb: from.db,
      toUrl: to.url,
      toDb: to.db,
    };
    await this.prisma.appSetting.upsert({
      where: { key: ODOO_CUTOVER_KEY },
      update: { value: value as Prisma.InputJsonValue },
      create: { key: ODOO_CUTOVER_KEY, value: value as Prisma.InputJsonValue },
    });
    await this.audit.log({
      user: actor,
      action: "odoo_origin_cutover",
      entity: "AppSetting",
      entityId: ODOO_CUTOVER_KEY,
      after: value,
    });
  }

  async activeMode(): Promise<OdooModeName | null> {
    const cfg = await this.odoo.readConfig();
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_MODES_KEY } });
    const modes = row?.value ? normalizeOdooModes(row.value, cfg) : inferOdooModes(cfg);
    return modes.active;
  }

  async cutoverState(): Promise<{ pending: boolean; at?: string; fromUrl?: string; toUrl?: string; fromDb?: string; toDb?: string } | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_CUTOVER_KEY } });
    if (!row?.value || typeof row.value !== "object") return null;
    return row.value as { pending: boolean; at?: string; fromUrl?: string; toUrl?: string; fromDb?: string; toDb?: string };
  }

  private async assertCompany(
    personal: OdooConfig,
    principal: OdooConfig,
    company: [number, string] | false | undefined,
  ) {
    if (!principal.user || !principal.apiKey) return;
    try {
      const uid = await this.odoo.authenticate(principal);
      const rows = (await this.odoo.executeKw(principal, uid, "res.users", "read", [[uid], ["company_id"]])) as Array<{
        company_id?: [number, string] | false;
      }>;
      const home = rows?.[0]?.company_id;
      if (Array.isArray(home) && Array.isArray(company) && home[0] !== company[0]) {
        throw new Error(`Tu usuario de Odoo está en ${company[1]} y la cuenta principal en ${home[1]}. Tienen que ser la misma compañía.`);
      }
    } catch (e) {
      if ((e as Error).message.includes("compañía")) throw e;
    }
  }
}

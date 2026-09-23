import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../auth/auth.types";
import { envOdooConfig, normalizeOdooConfig, ODOO_CONFIG_KEY, type OdooConfig } from "../domain/odoo-config";
import { redactOdooSecret } from "../domain/odoo-link";
import { OdooLinkService } from "./odoo-link.service";

export type OdooSaleClosePayload = {
  from: string;
  to: string;
  at: string;
  quoteId?: string;
};

type JsonRpcResponse = { result?: unknown; error?: { message?: string; data?: { message?: string } } };

@Injectable()
export class OdooClient {
  private readonly log = new Logger(OdooClient.name);
  private readonly uidCache = new Map<string, { uid: number; exp: number }>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OdooLinkService)) private readonly links: OdooLinkService,
  ) {}

  runAsQuoteVendor<T>(quoteId: string, fn: () => Promise<T>): Promise<T> {
    return this.prisma.quote
      .findUnique({
        where: { id: quoteId },
        select: {
          vendor: { select: { id: true, email: true, name: true, role: true, customerId: true, avatarKey: true, whatsapp: true } },
        },
      })
      .then((quote) => {
        const v = quote?.vendor;
        if (!v) return fn();
        const actor: AuthUser = {
          id: v.id,
          email: v.email,
          name: v.name,
          role: v.role,
          customerId: v.customerId,
          hasAvatar: !!v.avatarKey,
          whatsapp: v.whatsapp || "",
        };
        return this.links.runAs(actor, fn);
      });
  }

  private async session(): Promise<{ cfg: OdooConfig; uid: number; via: "principal" | "user" | "bypass" }> {
    const principal = await this.readConfig();
    const resolved = await this.links.resolveActing(principal);
    const cfg = resolved.cfg;
    const cacheKey = `${resolved.via}:${cfg.url}|${cfg.db}|${cfg.user}`;
    const hit = this.uidCache.get(cacheKey);
    if (hit && hit.exp > Date.now()) return { cfg, uid: hit.uid, via: resolved.via };
    try {
      const uid = await this.authenticate(cfg);
      this.uidCache.set(cacheKey, { uid, exp: Date.now() + 5 * 60 * 1000 });
      return { cfg, uid, via: resolved.via };
    } catch (e) {
      this.uidCache.delete(cacheKey);
      const actor = this.links.currentActor();
      if (resolved.via === "user" && actor) await this.links.markFailed(actor.id, (e as Error).message || "");
      throw new Error(redactOdooSecret((e as Error).message || "Odoo rechazó la clave.", cfg.apiKey));
    }
  }

  private async noteBypass(via: string, model: string, detail: string) {
    if (via !== "bypass") return;
    const actor = this.links.currentActor();
    if (!actor) return;
    await this.links.noteBypass(actor, model, detail);
  }

  async readConfig(): Promise<OdooConfig> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_CONFIG_KEY } });
    return normalizeOdooConfig(row?.value, envOdooConfig());
  }

  enqueueSaleClose(payload: OdooSaleClosePayload) {
    void this.readConfig().then((cfg) => {
      if (cfg.enabled && cfg.url) {
        this.log.log(`Odoo cierre (job sale_close aparte): ${cfg.url} / ${cfg.db}: ${JSON.stringify(payload)}`);
        return;
      }
      this.log.log(`Odoo en espera — cierre: ${JSON.stringify(payload)}`);
    });
    return { queued: true, mode: "queued" as const };
  }

  async probe() {
    const cfg = await this.readConfig();
    if (!cfg.url || !cfg.db || !cfg.user || !cfg.apiKey) {
      return { ok: false, message: "Faltan URL, base, usuario o clave de Odoo." };
    }
    try {
      const version = await this.call(cfg, "common", "version", []);
      const uid = await this.authenticate(cfg);
      const me = await this.executeKw(cfg, uid, "res.users", "read", [[uid], ["name", "login", "company_id"]]);
      return {
        ok: true,
        message: "Conexión correcta.",
        version,
        uid,
        user: Array.isArray(me) ? me[0] : me,
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async authenticate(cfg?: OdooConfig) {
    const c = cfg || (await this.readConfig());
    if (!c.url || !c.db || !c.user || !c.apiKey) {
      throw new Error("Odoo no está configurado.");
    }
    const uid = await this.call(c, "common", "authenticate", [c.db, c.user, c.apiKey, {}]);
    if (!uid || uid === false) throw new Error("Odoo rechazó usuario o clave.");
    return Number(uid);
  }

  async executeKw(
    cfg: OdooConfig,
    uid: number,
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {},
  ) {
    return this.call(cfg, "object", "execute_kw", [cfg.db, uid, cfg.apiKey, model, method, args, kwargs]);
  }

  async searchRead(
    model: string,
    domain: unknown[],
    fields: string[],
    extras: { limit?: number; offset?: number; order?: string } = {},
  ) {
    const { cfg, uid } = await this.session();
    const kwargs: Record<string, unknown> = {
      limit: extras.limit ?? 200,
      offset: extras.offset ?? 0,
    };
    if (extras.order) kwargs.order = extras.order;
    if (fields.length) kwargs.fields = fields;
    return (await this.executeKw(cfg, uid, model, "search_read", [domain], kwargs)) as Record<string, unknown>[];
  }

  async write(
    model: string,
    ids: number[],
    values: Record<string, unknown>,
    extras: { context?: Record<string, unknown> } = {},
  ) {
    const { cfg, uid, via } = await this.session();
    await this.noteBypass(via, model, `write ${ids.join(",")}`);
    const kwargs = extras.context ? { context: extras.context } : {};
    return this.executeKw(cfg, uid, model, "write", [ids, values], kwargs);
  }

  async create(
    model: string,
    values: Record<string, unknown>,
    extras: { context?: Record<string, unknown> } = {},
  ) {
    const { cfg, uid, via } = await this.session();
    await this.noteBypass(via, model, "create");
    const kwargs = extras.context ? { context: extras.context } : {};
    return this.executeKw(cfg, uid, model, "create", [values], kwargs);
  }

  async callKw(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {},
  ) {
    const { cfg, uid, via } = await this.session();
    await this.noteBypass(via, model, method);
    return this.executeKw(cfg, uid, model, method, args, kwargs);
  }

  async unlink(model: string, ids: number[], extras: { context?: Record<string, unknown> } = {}) {
    if (!ids.length) return true;
    const { cfg, uid, via } = await this.session();
    await this.noteBypass(via, model, `unlink ${ids.join(",")}`);
    const kwargs = extras.context ? { context: extras.context } : {};
    return this.executeKw(cfg, uid, model, "unlink", [ids], kwargs);
  }

  async read(model: string, ids: number[], fields: string[]) {
    const { cfg, uid } = await this.session();
    return (await this.executeKw(cfg, uid, model, "read", [ids, fields])) as Record<string, unknown>[];
  }

  async fieldsGet(model: string) {
    const { cfg, uid } = await this.session();
    return (await this.executeKw(cfg, uid, model, "fields_get", [], {
      attributes: ["string", "type", "selection"],
    })) as Record<string, { string?: string; type?: string; selection?: [string, string][] }>;
  }

  private async call(cfg: OdooConfig, service: string, method: string, args: unknown[]) {
    const base = cfg.url.replace(/\/$/, "");
    const res = await fetch(`${base}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id: Date.now(),
      }),
    });
    if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
    const body = (await res.json()) as JsonRpcResponse;
    if (body.error) {
      throw new Error(body.error.data?.message || body.error.message || "Error Odoo");
    }
    return body.result;
  }
}

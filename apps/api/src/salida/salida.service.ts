import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import {
  SALIDA_CONFIG_KEY,
  SalidaConfig,
  SalidaResult,
  buildSalidaTest,
  buildShareNotice,
  normalizeSalidaConfig,
  presentSalidaConfig,
  readSalidaStates,
  ShareNoticeInput,
  shareNoticePack,
} from "../domain/salida";

@Injectable()
export class SalidaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async read(): Promise<SalidaConfig> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SALIDA_CONFIG_KEY } });
    try {
      return normalizeSalidaConfig(row?.value || {});
    } catch {
      return { url: "https://ztrack.app/servicio/salida", clave: "", channel: "ninguno" };
    }
  }

  async present() {
    return presentSalidaConfig(await this.read());
  }

  async save(body: Record<string, unknown>, user: AuthUser, ip?: string) {
    const previous = await this.read();
    let next: SalidaConfig;
    try {
      next = normalizeSalidaConfig(body, previous);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    await this.prisma.appSetting.upsert({
      where: { key: SALIDA_CONFIG_KEY },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { key: SALIDA_CONFIG_KEY, value: next as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "AppSetting",
      entityId: SALIDA_CONFIG_KEY,
      after: { url: next.url, channel: next.channel, claveSet: Boolean(next.clave) },
      ip,
    });
    return presentSalidaConfig(next);
  }

  async probe() {
    const cfg = await this.read();
    if (!cfg.clave) return { ok: false, message: "Guarda la clave de salida antes de probar." };
    try {
      const res = await this.post(cfg, {});
      if (res.status === 401) return { ok: false, message: "La clave no fue aceptada." };
      if (res.status === 400) return { ok: true, message: "La conexión responde. No se envió ningún mensaje." };
      return { ok: false, message: `La salida respondió ${res.status}.` };
    } catch {
      return { ok: false, message: "No se pudo conectar con la URL de salida." };
    }
  }

  async sendTest(body: Record<string, unknown>, user: AuthUser, ip?: string) {
    const cfg = await this.read();
    if (!cfg.clave) throw new BadRequestException("Guarda la clave de salida antes de enviar una prueba.");
    const built = buildSalidaTest({
      whatsapp: body.whatsapp === true,
      correo: body.correo === true,
      telefono: String(body.telefono || ""),
      contacto: String(body.contacto || ""),
      email: String(body.email || ""),
      mensaje: String(body.mensaje || ""),
    });
    if (!built.body) throw new BadRequestException(built.plan.motivo || "Revisa los datos de la prueba.");
    let result: SalidaResult;
    try {
      const res = await this.post(cfg, built.body);
      const data = this.parse(res.text);
      if (res.status === 401) {
        result = { ...built.plan, whatsapp: built.body.whatsapp ? "error" : built.plan.whatsapp, correo: built.body.correo ? "error" : built.plan.correo, motivo: "La clave de salida no fue aceptada." };
      } else if (!res.ok && res.status !== 400) {
        result = { ...built.plan, whatsapp: built.body.whatsapp ? "error" : built.plan.whatsapp, correo: built.body.correo ? "error" : built.plan.correo, motivo: `La salida respondió ${res.status}.` };
      } else {
        result = readSalidaStates(data, built.plan);
      }
    } catch {
      result = { ...built.plan, whatsapp: built.body.whatsapp ? "error" : built.plan.whatsapp, correo: built.body.correo ? "error" : built.plan.correo, motivo: "No se pudo conectar con la salida." };
    }
    await this.audit.log({
      user,
      action: "salida_test",
      entity: "AppSetting",
      entityId: SALIDA_CONFIG_KEY,
      after: { channel: result.channel, whatsapp: result.whatsapp, correo: result.correo },
      ip,
    });
    const failed = result.whatsapp === "error" || result.correo === "error" || result.whatsapp === "rechazado" || result.correo === "rechazado";
    return { ok: !failed, salida: result };
  }

  async notifyShare(input: ShareNoticeInput): Promise<SalidaResult> {
    const cfg = await this.read();
    const pack = shareNoticePack(input);
    return this.deliver(cfg, buildShareNotice({
      channel: cfg.channel,
      phone: input.phone,
      email: input.email,
      message: pack.whatsapp,
      emailBody: pack.email,
      html: pack.html,
      contact: input.vendorPhone,
      subject: pack.subject,
    }));
  }

  /** Solo correo, si el canal guardado incluye correo. */
  async notifyMail(input: { email: string; subject: string; message: string }): Promise<SalidaResult> {
    const cfg = await this.read();
    const channel = cfg.channel === "ambos" || cfg.channel === "correo" ? "correo" : "ninguno";
    return this.deliver(cfg, buildShareNotice({
      channel,
      phone: "",
      email: input.email,
      message: input.message,
      contact: "",
      subject: input.subject,
    }));
  }

  /** Solo el WhatsApp, para reintentar si el anterior todavía está en cola. */
  async notifyWhatsapp(input: { phone: string; contact: string; message: string }): Promise<SalidaResult> {
    const cfg = await this.read();
    const channel = cfg.channel === "ambos" || cfg.channel === "whatsapp" ? "whatsapp" : "ninguno";
    return this.deliver(cfg, buildShareNotice({
      channel,
      phone: input.phone,
      email: "",
      message: input.message,
      contact: input.contact,
      subject: "Aviso",
    }));
  }

  /** Aviso corto, con el mismo canal guardado. No arma la carta del catálogo. */
  async notifyText(input: { phone: string; email: string; contact: string; subject: string; message: string; html?: string }): Promise<SalidaResult> {
    const cfg = await this.read();
    return this.deliver(cfg, buildShareNotice({
      channel: cfg.channel,
      phone: input.phone,
      email: input.email,
      message: input.message,
      html: input.html,
      contact: input.contact,
      subject: input.subject,
    }));
  }

  private async deliver(cfg: SalidaConfig, built: { body: Record<string, unknown> | null; plan: SalidaResult }): Promise<SalidaResult> {
    if (!built.body) return built.plan;
    if (!cfg.clave) {
      return {
        ...built.plan,
        whatsapp: built.plan.whatsapp === "en_cola" ? "error" : built.plan.whatsapp,
        correo: built.plan.correo === "en_cola" ? "error" : built.plan.correo,
        motivo: "Falta la clave de salida.",
      };
    }
    try {
      const res = await this.post(cfg, built.body);
      const data = this.parse(res.text);
      if (res.status === 401) {
        return { ...built.plan, whatsapp: built.body.whatsapp ? "error" : built.plan.whatsapp, correo: built.body.correo ? "error" : built.plan.correo, motivo: "La clave de salida no fue aceptada." };
      }
      if (!res.ok && res.status !== 400) {
        return { ...built.plan, whatsapp: built.body.whatsapp ? "error" : built.plan.whatsapp, correo: built.body.correo ? "error" : built.plan.correo, motivo: `La salida respondió ${res.status}.` };
      }
      return readSalidaStates(data, built.plan);
    } catch {
      return { ...built.plan, whatsapp: built.body.whatsapp ? "error" : built.plan.whatsapp, correo: built.body.correo ? "error" : built.plan.correo, motivo: "No se pudo conectar con la salida." };
    }
  }

  private async post(cfg: SalidaConfig, body: Record<string, unknown>) {
    const res = await fetch(cfg.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "content-type": "application/json",
        "x-salida-clave": cfg.clave,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text: text.slice(0, 2000) };
  }

  private parse(text: string) {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Response } from "express";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "./auth.types";

const ACCESS_MS = 15 * 60 * 1000;
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  private cookiePath() {
    return process.env.COOKIE_PATH || "/zdry";
  }

  private cookieOpts(maxAge: number) {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.COOKIE_SECURE === "true",
      path: this.cookiePath(),
      maxAge,
    };
  }

  private signAccess(user: AuthUser, actor?: AuthUser | null) {
    return this.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        typ: "access",
        ...(actor ? { act: actor.id } : {}),
      },
      { expiresIn: "15m" },
    );
  }

  private signRefresh(user: AuthUser, actor?: AuthUser | null) {
    return this.jwt.sign(
      actor
        ? { sub: user.id, act: actor.id, typ: "impersonate_refresh" }
        : { sub: user.id, typ: "refresh" },
      { expiresIn: "7d" },
    );
  }

  setAuthCookies(res: Response, user: AuthUser, access: string, refresh: string) {
    res.cookie("zdry_access", access, this.cookieOpts(ACCESS_MS));
    res.cookie("zdry_refresh", refresh, this.cookieOpts(REFRESH_MS));
  }

  clearAuthCookies(res: Response) {
    res.clearCookie("zdry_access", { path: this.cookiePath() });
    res.clearCookie("zdry_refresh", { path: this.cookiePath() });
  }

  toPublic(user: AuthUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customerId ?? null,
      impersonator: user.impersonator ?? null,
    };
  }

  private asAuth(
    user: { id: string; email: string; name: string; role: AuthUser["role"]; customerId?: string | null },
    impersonator?: AuthUser["impersonator"],
  ): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customerId ?? null,
      impersonator: impersonator ?? null,
    };
  }

  async login(email: string, password: string, ip: string | undefined, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !user.active) {
      throw new UnauthorizedException("Correo o contraseña incorrectos");
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException("Correo o contraseña incorrectos");
    }
    const authUser = this.asAuth(user);
    const access = this.signAccess(authUser);
    const refresh = this.signRefresh(authUser);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: await argon2.hash(refresh) },
    });
    this.setAuthCookies(res, authUser, access, refresh);
    await this.audit.log({ user: authUser, action: "login", entity: "User", entityId: user.id, ip });
    return { user: this.toPublic(authUser) };
  }

  async register(
    input: { email?: string; password?: string; name?: string; companyName?: string; rucDni?: string; phone?: string },
    ip: string | undefined,
    res: Response,
  ) {
    const email = (input.email || "").trim().toLowerCase();
    const password = input.password || "";
    const name = (input.name || "").trim();
    const companyName = (input.companyName || "").trim();
    const rucDni = (input.rucDni || "").trim();
    const phone = (input.phone || "").trim();
    if (!email || !password || password.length < 8) throw new BadRequestException("Correo y clave de al menos 8 caracteres.");
    if (!companyName || !rucDni) throw new BadRequestException("Empresa y RUC/DNI son obligatorios.");
    if (!name || !phone) throw new BadRequestException("Persona de contacto y teléfono son obligatorios.");
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException("Ya existe una cuenta con ese correo.");
    const hash = await argon2.hash(password);
    let customer = await this.prisma.customer.findFirst({ where: { OR: [{ email }, { rucDni }] } });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: { rucDni, companyName, email, phone, risk: "B" },
      });
    }
    const user = await this.prisma.user.create({
      data: { email, passwordHash: hash, name, role: "cliente", customerId: customer.id },
    });
    const authUser = this.asAuth(user);
    const access = this.signAccess(authUser);
    const refresh = this.signRefresh(authUser);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: await argon2.hash(refresh) },
    });
    this.setAuthCookies(res, authUser, access, refresh);
    await this.audit.log({ user: authUser, action: "register", entity: "User", entityId: user.id, ip });
    return { user: this.toPublic(authUser) };
  }

  async refresh(refreshToken: string | undefined, res: Response) {
    if (!refreshToken) throw new UnauthorizedException("Sin sesión");
    let payload: { sub: string; typ: string; act?: string };
    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException("Sesión vencida");
    }

    if (payload.typ === "impersonate_refresh") {
      if (!payload.act) throw new UnauthorizedException("Token inválido");
      const [target, actor] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: payload.sub } }),
        this.prisma.user.findUnique({ where: { id: payload.act } }),
      ]);
      if (!target?.active || !actor?.active || actor.role !== "admin") {
        throw new UnauthorizedException("La sesión asistida ya no es válida.");
      }
      const actorAuth = this.asAuth(actor);
      const targetAuth = this.asAuth(target, {
        id: actor.id,
        email: actor.email,
        name: actor.name,
        role: actor.role,
      });
      const access = this.signAccess(targetAuth, actorAuth);
      const nextRefresh = this.signRefresh(targetAuth, actorAuth);
      this.setAuthCookies(res, targetAuth, access, nextRefresh);
      return { user: this.toPublic(targetAuth) };
    }

    if (payload.typ !== "refresh") throw new UnauthorizedException("Token inválido");
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active || !user.refreshTokenHash) {
      throw new UnauthorizedException("Sesión inválida");
    }
    const match = await argon2.verify(user.refreshTokenHash, refreshToken);
    if (!match) throw new UnauthorizedException("Sesión inválida");
    const authUser = this.asAuth(user);
    const access = this.signAccess(authUser);
    const nextRefresh = this.signRefresh(authUser);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: await argon2.hash(nextRefresh) },
    });
    this.setAuthCookies(res, authUser, access, nextRefresh);
    return { user: this.toPublic(authUser) };
  }

  async logout(user: AuthUser | undefined, ip: string | undefined, res: Response) {
    const realId = user?.impersonator?.id || user?.id;
    if (realId) {
      await this.prisma.user.update({ where: { id: realId }, data: { refreshTokenHash: null } });
      if (user) await this.audit.log({ user, action: "logout", entity: "User", entityId: realId, ip });
    }
    this.clearAuthCookies(res);
    return { ok: true };
  }

  async forgotPassword(email: string, ip: string | undefined) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (user) {
      await this.audit.log({
        action: "forgot_password",
        entity: "User",
        entityId: user.id,
        ip,
        after: { note: "stub Sprint 1 — correo real en S10" },
      });
    }
    return { ok: true, message: "Si el correo existe, enviaremos instrucciones." };
  }

  async impersonate(admin: AuthUser, targetId: string, ip: string | undefined, res: Response) {
    if (admin.impersonator) throw new BadRequestException("Ya estás en una sesión asistida. Vuelve a tu usuario primero.");
    if (admin.role !== "admin") throw new ForbiddenException("Solo el administrador puede ver la interfaz de otro usuario.");
    if (!targetId || targetId === admin.id) throw new BadRequestException("Elige un usuario distinto.");
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new BadRequestException("Usuario no encontrado.");
    if (!target.active) throw new BadRequestException("Ese usuario está inactivo.");
    const targetAuth = this.asAuth(target, {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    });
    const access = this.signAccess(targetAuth, admin);
    const refresh = this.signRefresh(targetAuth, admin);
    this.setAuthCookies(res, targetAuth, access, refresh);
    await this.audit.log({
      user: admin,
      action: "impersonate",
      entity: "User",
      entityId: target.id,
      after: { as: target.email, asRole: target.role, asName: target.name },
      ip,
    });
    return { user: this.toPublic(targetAuth) };
  }

  async stopImpersonate(user: AuthUser, ip: string | undefined, res: Response) {
    if (!user.impersonator) throw new BadRequestException("No hay sesión asistida activa.");
    const admin = await this.prisma.user.findUnique({ where: { id: user.impersonator.id } });
    if (!admin || !admin.active || admin.role !== "admin") {
      this.clearAuthCookies(res);
      throw new UnauthorizedException("No se pudo restaurar la sesión del administrador.");
    }
    const adminAuth = this.asAuth(admin);
    const access = this.signAccess(adminAuth);
    const refresh = this.signRefresh(adminAuth);
    await this.prisma.user.update({
      where: { id: admin.id },
      data: { refreshTokenHash: await argon2.hash(refresh) },
    });
    this.setAuthCookies(res, adminAuth, access, refresh);
    await this.audit.log({
      user: adminAuth,
      action: "stop_impersonate",
      entity: "User",
      entityId: user.id,
      after: { was: user.email },
      ip,
    });
    return { user: this.toPublic(adminAuth) };
  }

  async updateProfile(user: AuthUser, body: { name?: string; email?: string }, ip?: string) {
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    if (!name) throw new BadRequestException("El nombre es obligatorio.");
    if (!email) throw new BadRequestException("El correo es obligatorio.");
    const clash = await this.prisma.user.findFirst({ where: { email, NOT: { id: user.id } } });
    if (clash) throw new ConflictException("Ya existe una cuenta con ese correo.");
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: { name, email },
    });
    await this.audit.log({
      user,
      action: "update_profile",
      entity: "User",
      entityId: user.id,
      after: { name: row.name, email: row.email },
      ip,
    });
    return this.toPublic(this.asAuth(row, user.impersonator));
  }

  async changePassword(user: AuthUser, currentPassword: string, nextPassword: string) {
    if (user.impersonator) {
      throw new ForbiddenException("En una sesión asistida no se cambia la clave. Restablécela en Personas o pide al usuario que lo haga.");
    }
    if (!nextPassword || nextPassword.length < 8) throw new BadRequestException("La nueva clave debe tener al menos 8 caracteres.");
    if (!currentPassword) throw new BadRequestException("Indica tu clave actual.");
    const row = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!row) throw new UnauthorizedException("Sesión inválida");
    const ok = await argon2.verify(row.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException("La clave actual no es correcta.");
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(nextPassword) },
    });
    await this.audit.log({ user, action: "change_password", entity: "User", entityId: user.id });
    return { ok: true };
  }
}

import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
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

  private signAccess(user: AuthUser) {
    return this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role, name: user.name, typ: "access" },
      { expiresIn: "15m" },
    );
  }

  private signRefresh(user: AuthUser) {
    return this.jwt.sign(
      { sub: user.id, typ: "refresh" },
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
    return { id: user.id, email: user.email, name: user.name, role: user.role, customerId: user.customerId ?? null };
  }

  private asAuth(user: { id: string; email: string; name: string; role: AuthUser["role"]; customerId?: string | null }): AuthUser {
    return { id: user.id, email: user.email, name: user.name, role: user.role, customerId: user.customerId ?? null };
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
    let payload: { sub: string; typ: string };
    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException("Sesión vencida");
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
    if (user) {
      await this.prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: null } });
      await this.audit.log({ user, action: "logout", entity: "User", entityId: user.id, ip });
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
}

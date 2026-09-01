import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "./auth.types";

type AccessPayload = {
  sub: string;
  email: string;
  role: string;
  name: string;
  typ: string;
  act?: string;
};

function cookieOrBearer(req: Request): string | null {
  const fromCookie = req.cookies?.zdry_access as string | undefined;
  if (fromCookie) return fromCookie;
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: cookieOrBearer,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || "cambiar-en-produccion",
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    if (payload.typ !== "access") {
      throw new UnauthorizedException("Token inválido");
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException("Sesión inválida");
    }
    const auth: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customerId,
      hasAvatar: !!user.avatarKey,
    };
    if (payload.act && payload.act !== user.id) {
      const actor = await this.prisma.user.findUnique({ where: { id: payload.act } });
      if (!actor || !actor.active || actor.role !== "admin") {
        throw new UnauthorizedException("La sesión asistida ya no es válida.");
      }
      auth.impersonator = { id: actor.id, email: actor.email, name: actor.name, role: actor.role };
    }
    return auth;
  }
}

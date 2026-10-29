import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { ALLOW_PASSWORD_CHANGE_KEY } from "./password-change.decorator";
import { AuthUser } from "./auth.types";

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const allow = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allow) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (user?.mustChangePassword) {
      throw new ForbiddenException("Actualiza tu clave para continuar.");
    }
    return true;
  }
}

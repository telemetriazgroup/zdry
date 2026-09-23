import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { defaultIfEmpty, firstValueFrom, from, Observable } from "rxjs";
import { AuthUser } from "../auth/auth.types";
import { OdooLinkService } from "./odoo-link.service";

@Injectable()
export class OdooActorInterceptor implements NestInterceptor {
  constructor(private readonly links: OdooLinkService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user?.id) return next.handle();
    return from(this.links.runAs(user, () => firstValueFrom(next.handle().pipe(defaultIfEmpty(undefined)))));
  }
}

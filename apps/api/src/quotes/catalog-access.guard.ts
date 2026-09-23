import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { CatalogSharesService } from "../catalog-shares/catalog-shares.service";

@Injectable()
export class CatalogAccessGuard implements CanActivate {
  constructor(private readonly shares: CatalogSharesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: unknown; cookies?: { zdry_catalog?: string } }>();
    if (req.user) return true;
    if (await this.shares.cookieAllows(req.cookies?.zdry_catalog)) return true;
    throw new UnauthorizedException("Para ver el catálogo entra con tu cuenta o con la clave del enlace.");
  }
}

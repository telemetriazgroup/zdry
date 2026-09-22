import { Controller, Get } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@Roles("superadmin", "admin", "gerente", "vendedor", "compras", "coordinador", "almacen")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  present(@CurrentUser() user: AuthUser) {
    return this.dashboard.present(user);
  }
}

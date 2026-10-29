import { Controller, Get, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { AuditService } from "./audit.service";

@Controller("audit")
@Roles("superadmin", "admin")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("comerciales")
  @Roles("superadmin", "admin", "ejecutivo")
  commercial() {
    return this.audit.commercialActivity();
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("take") take?: string,
  ) {
    return this.audit.list(from, to, take ? Number(take) : 2000, user);
  }
}

import { Controller, Get, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { AuditService } from "./audit.service";

@Controller("audit")
@Roles("superadmin")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query("from") from?: string, @Query("to") to?: string, @Query("take") take?: string) {
    return this.audit.list(from, to, take ? Number(take) : 2000);
  }
}

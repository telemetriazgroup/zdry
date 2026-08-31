import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      ok: true,
      service: "zdry-api",
      tz: process.env.TZ || "America/Lima",
      odoo: process.env.ODOO_ENABLED === "true" ? "enabled" : "noop",
    };
  }
}

import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
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

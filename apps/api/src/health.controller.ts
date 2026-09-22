import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator";
import { envOdooConfig, odooCredentialsReady } from "./domain/odoo-config";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      ok: true,
      service: "zdry-api",
      tz: process.env.TZ || "America/Lima",
      odoo: odooCredentialsReady(envOdooConfig()) ? "enabled" : "noop",
    };
  }
}

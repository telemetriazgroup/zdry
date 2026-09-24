import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ODOO_WATCH_MS } from "../domain/odoo-import-watch";
import { OdooImportService } from "./odoo-import.service";

@Injectable()
export class OdooImportWatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OdooImportWatchWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private boot: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;

  constructor(private readonly imports: OdooImportService) {}

  onModuleInit() {
    this.boot = setTimeout(() => {
      this.tick();
    }, 30_000);
    this.timer = setInterval(() => {
      this.tick();
    }, ODOO_WATCH_MS);
  }

  onModuleDestroy() {
    if (this.boot) clearTimeout(this.boot);
    if (this.timer) clearInterval(this.timer);
  }

  private tick() {
    if (this.ticking) return;
    this.ticking = true;
    void this.imports
      .syncNewIfAuto()
      .catch((e) => this.log.warn(`búsqueda automática: ${(e as Error).message}`))
      .finally(() => {
        this.ticking = false;
      });
  }
}

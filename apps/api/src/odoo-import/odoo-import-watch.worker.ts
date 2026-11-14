import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ODOO_EXPEDIENTE_MS, ODOO_WATCH_MS } from "../domain/odoo-import-watch";
import { OdooImportService } from "./odoo-import.service";

@Injectable()
export class OdooImportWatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OdooImportWatchWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private expedienteTimer: ReturnType<typeof setInterval> | null = null;
  private boot: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly imports: OdooImportService) {}

  onModuleInit() {
    this.boot = setTimeout(() => {
      this.tickNew();
    }, 30_000);
    this.timer = setInterval(() => {
      this.tickNew();
    }, ODOO_WATCH_MS);
    this.expedienteTimer = setInterval(() => {
      this.tickExpediente();
    }, ODOO_EXPEDIENTE_MS);
  }

  onModuleDestroy() {
    if (this.boot) clearTimeout(this.boot);
    if (this.timer) clearInterval(this.timer);
    if (this.expedienteTimer) clearInterval(this.expedienteTimer);
  }

  private tickNew() {
    void this.imports
      .syncNewIfAuto()
      .catch((e) => this.log.warn(`búsqueda automática: ${(e as Error).message}`));
  }

  private tickExpediente() {
    void this.imports
      .refreshExpedientesIfAuto()
      .catch((e) => this.log.warn(`expedientes: ${(e as Error).message}`));
  }
}

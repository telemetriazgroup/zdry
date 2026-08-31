import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const DEMO_MODE_KEY = "demo_mode";
const DEMO_LOADED_KEY = "demo_loaded";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private demoCache: { on: boolean; at: number } | null = null;

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  clearDemoCache() {
    this.demoCache = null;
  }

  async demoOn(): Promise<boolean> {
    if (this.demoCache && Date.now() - this.demoCache.at < 2000) return this.demoCache.on;
    const row = await this.appSetting.findUnique({ where: { key: DEMO_MODE_KEY } });
    const on = !!(row?.value as { on?: boolean } | null)?.on;
    this.demoCache = { on, at: Date.now() };
    return on;
  }

  /** When demo mode is off, hide rows tagged `demo: true` so production data stays visible alone. */
  async hideDemo(): Promise<{ demo?: false }> {
    return (await this.demoOn()) ? {} : { demo: false };
  }

  async setDemoMode(on: boolean) {
    await this.appSetting.upsert({
      where: { key: DEMO_MODE_KEY },
      update: { value: { on } },
      create: { key: DEMO_MODE_KEY, value: { on } },
    });
    this.clearDemoCache();
  }

  async setDemoLoaded(loaded: boolean) {
    await this.appSetting.upsert({
      where: { key: DEMO_LOADED_KEY },
      update: { value: { loaded, at: new Date().toISOString() } },
      create: { key: DEMO_LOADED_KEY, value: { loaded, at: new Date().toISOString() } },
    });
  }

  async demoLoaded(): Promise<boolean> {
    const row = await this.appSetting.findUnique({ where: { key: DEMO_LOADED_KEY } });
    return !!(row?.value as { loaded?: boolean } | null)?.loaded;
  }
}

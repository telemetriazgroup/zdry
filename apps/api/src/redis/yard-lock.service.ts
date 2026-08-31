import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import Redis from "ioredis";
import { REDIS } from "./redis.constants";

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

@Injectable()
export class YardLockService {
  private readonly log = new Logger(YardLockService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async withYardLock<T>(depotId: string, fn: () => Promise<T>): Promise<T> {
    return this.withKey(`yard:${depotId}`, fn, "El patio está ocupado por otra operación. Reintenta en unos segundos.");
  }

  async withIsoLock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
    return this.withKey(`iso:${iso}`, fn, "Esta unidad ya está siendo reservada por otra operación.");
  }

  async withQuoteLock<T>(quoteId: string, fn: () => Promise<T>): Promise<T> {
    return this.withKey(`quote:${quoteId}`, fn, "Esta cotización está siendo actualizada por otra operación.");
  }

  async withKey<T>(suffix: string, fn: () => Promise<T>, busyMessage?: string): Promise<T> {
    const key = `lock:${suffix}`;
    const token = randomUUID();
    let acquired = false;
    try {
      for (let i = 0; i < 50; i++) {
        const ok = await this.redis.set(key, token, "EX", 15, "NX");
        if (ok === "OK") {
          acquired = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    } catch (e) {
      this.log.warn(`Redis no disponible (${(e as Error).message}) — se continúa con FOR UPDATE`);
      return fn();
    }
    if (!acquired) {
      throw new ConflictException(busyMessage || "Operación en curso. Reintenta en unos segundos.");
    }
    try {
      return await fn();
    } finally {
      try {
        await this.redis.eval(RELEASE, 1, key, token);
      } catch {
        /* ignore */
      }
    }
  }
}

import { Global, Module } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS } from "./redis.constants";
import { YardLockService } from "./yard-lock.service";

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          lazyConnect: false,
        }),
    },
    YardLockService,
  ],
  exports: [YardLockService, REDIS],
})
export class RedisModule {}

import { Module } from "@nestjs/common";
import { DemoModule } from "../demo/demo.module";
import { SuperadminController } from "./superadmin.controller";
import { SuperadminService } from "./superadmin.service";

@Module({
  imports: [DemoModule],
  controllers: [SuperadminController],
  providers: [SuperadminService],
})
export class SuperadminModule {}

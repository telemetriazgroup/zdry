import { Global, Module } from "@nestjs/common";
import { OdooClient } from "./odoo.client";

@Global()
@Module({
  providers: [OdooClient],
  exports: [OdooClient],
})
export class OdooModule {}

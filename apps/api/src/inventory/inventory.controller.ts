import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { PurchasesService } from "../purchases/purchases.service";

@Controller("inventory")
export class InventoryController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.purchases.listContainersForRole(user.role);
  }

  @Get("sample")
  sample(@CurrentUser() user: AuthUser) {
    return this.purchases.listContainersForRole(user.role);
  }
}

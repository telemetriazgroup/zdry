import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser, canSeeMargin, canSeeRealCosts } from "../auth/auth.types";

const SAMPLE = [
  {
    iso: "CSQU3054383",
    type: "40HC",
    cat: "1TRIP",
    status: "Disponible",
    depot: "Patio Callao",
    priceList: 2850,
    priceMin: 2600,
    costs: { fob: 1720, cT: 2140, cTReal: 2310 },
  },
  {
    iso: "TCLU7788123",
    type: "20GP",
    cat: "CW",
    status: "Reservado",
    depot: "Patio Ventanilla",
    priceList: 1650,
    priceMin: 1480,
    costs: { fob: 980, cT: 1210, cTReal: 1295 },
  },
];

@Controller("inventory")
export class InventoryController {
  @Get("sample")
  sample(@CurrentUser() user: AuthUser) {
    const seeCosts = canSeeRealCosts(user.role);
    const seeMargin = canSeeMargin(user.role);
    return SAMPLE.map((c) => {
      const marginPct = c.priceList ? Math.round(((c.priceList - c.costs.cT) / c.priceList) * 1000) / 10 : 0;
      const base: Record<string, unknown> = {
        iso: c.iso,
        type: c.type,
        cat: c.cat,
        status: c.status,
        depot: c.depot,
      };
      if (user.role !== "almacen") {
        base.priceList = c.priceList;
        base.priceMin = c.priceMin;
      }
      if (seeMargin) base.marginPct = marginPct;
      if (seeCosts) base.costs = c.costs;
      return base;
    });
  }
}

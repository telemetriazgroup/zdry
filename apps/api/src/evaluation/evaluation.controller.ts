import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { EvaluationService } from "./evaluation.service";

@Controller("evaluation")
@Roles("admin", "gerente")
export class EvaluationController {
  constructor(private readonly evaluation: EvaluationService) {}

  @Get("offer-rules")
  offerRules() {
    return this.evaluation.offerConditionConfig();
  }

  @Put("offer-rules")
  saveOfferRules(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.evaluation.saveOfferConditionConfig(body, user, req.ip);
  }
}

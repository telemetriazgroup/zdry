import { Body, Controller, Get, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { OdooLinkService } from "./odoo-link.service";

@Controller("odoo-link")
export class OdooLinkController {
  constructor(private readonly links: OdooLinkService) {}

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.links.statusFor(user);
  }

  @Post("test")
  test(@Body() body: { email?: string; apiKey?: string }, @CurrentUser() user: AuthUser) {
    return this.links.test(user, body);
  }
}

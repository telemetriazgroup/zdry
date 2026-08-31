import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import { CurrentUser } from "./current-user.decorator";
import { AuthUser } from "./auth.types";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  register(
    @Body() body: { email?: string; password?: string; name?: string; companyName?: string; rucDni?: string; phone?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.register(body, req.ip, res);
  }

  @Public()
  @Post("login")
  login(
    @Body() body: { email?: string; password?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(body.email || "", body.password || "", req.ip, res);
  }

  @Public()
  @Post("refresh")
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req.cookies?.zdry_refresh, res);
  }

  @Post("logout")
  logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(user, req.ip, res);
  }

  @Public()
  @Post("logout-all")
  logoutPublic(@Res({ passthrough: true }) res: Response) {
    this.auth.clearAuthCookies(res);
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return { user: this.auth.toPublic(user) };
  }

  @Public()
  @Post("forgot-password")
  forgot(@Body() body: { email?: string }, @Req() req: Request) {
    return this.auth.forgotPassword(body.email || "", req.ip);
  }
}

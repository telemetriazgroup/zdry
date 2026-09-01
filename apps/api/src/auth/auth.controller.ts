import { Body, Controller, Delete, Get, Post, Put, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import { Roles } from "./roles.decorator";
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

  @Put("profile")
  updateProfile(
    @Body() body: { name?: string; email?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.auth.updateProfile(user, body, req.ip);
  }

  @Post("password")
  changePassword(
    @Body() body: { currentPassword?: string; newPassword?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.auth.changePassword(user, body.currentPassword || "", body.newPassword || "");
  }

  @Post("impersonate")
  @Roles("admin")
  impersonate(
    @Body() body: { userId?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.impersonate(user, body.userId || "", req.ip, res);
  }

  @Post("stop-impersonate")
  stopImpersonate(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.stopImpersonate(user, req.ip, res);
  }

  @Public()
  @Post("forgot-password")
  forgot(@Body() body: { email?: string }, @Req() req: Request) {
    return this.auth.forgotPassword(body.email || "", req.ip);
  }

  @Post("avatar")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } }))
  uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.auth.uploadAvatar(user, file, req.ip);
  }

  @Get("avatar")
  async avatar(@CurrentUser() user: AuthUser) {
    const obj = await this.auth.openAvatar(user);
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "image/jpeg",
      length: obj.contentLength,
    });
  }

  @Delete("avatar")
  deleteAvatar(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.deleteAvatar(user, req.ip);
  }
}

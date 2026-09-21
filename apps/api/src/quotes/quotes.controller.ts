import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { QuotesService } from "./quotes.service";

const VOUCHER_UPLOAD = {
  storage: memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
};

@Controller("quotes")
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @Roles("admin", "gerente", "vendedor")
  list(@Query("status") status?: string, @Query("kind") kind?: string) {
    return this.quotes.listForStaff(status, kind);
  }

  @Post("expire-now")
  @Roles("admin", "gerente", "vendedor")
  expireNow() {
    return this.quotes.expireHolds();
  }

  @Get(":id/pdf")
  async pdf(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const out = await this.quotes.pdf(id, user);
    const filename = out.filename.replace(/"/g, "");
    return new StreamableFile(out.buffer, {
      type: "application/pdf",
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Get(":id/cronograma")
  async cronograma(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const out = await this.quotes.cronogramaPdf(id, user);
    const filename = out.filename.replace(/"/g, "");
    return new StreamableFile(out.buffer, {
      type: "application/pdf",
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Get(":id/vouchers/:vid")
  voucherFile(@Param("id") id: string, @Param("vid") vid: string, @CurrentUser() user: AuthUser) {
    return this.quotes.voucherFile(id, vid, user);
  }

  @Get(":id")
  getOne(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.quotes.getOne(id, user);
  }

  @Post(":id/issue-odoo")
  @Roles("admin", "gerente", "vendedor", "superadmin")
  issueOdoo(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.issueOdoo(id, user, req.ip);
  }

  @Post(":id/send")
  @Roles("admin", "gerente", "vendedor")
  send(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.send(id, user, req.ip);
  }

  @Post(":id/reserve")
  @Roles("admin", "gerente", "vendedor")
  reserve(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.reserve(id, user, req.ip);
  }

  @Post(":id/thread")
  thread(@Param("id") id: string, @Body() body: { body?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.thread(id, body.body || "", user, req.ip);
  }

  @Post(":id/grant-discount")
  @Roles("admin", "gerente", "vendedor")
  grant(
    @Param("id") id: string,
    @Body() body: { iso?: string; priceNet?: number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.grantDiscount(id, body.iso || "", Number(body.priceNet), user, req.ip);
  }

  @Post(":id/grant-rent")
  @Roles("admin", "gerente", "vendedor")
  grantRent(
    @Param("id") id: string,
    @Body() body: { priceNet?: number; months?: number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.grantRent(id, Number(body.priceNet), body.months != null ? Number(body.months) : undefined, user, req.ip);
  }

  @Patch(":id/amend-odoo")
  @Roles("admin", "gerente", "vendedor", "superadmin")
  amendOdoo(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.amendOdoo(id, user, req.ip);
  }

  @Post(":id/close-odoo")
  @Roles("admin", "gerente", "vendedor", "superadmin")
  closeOdoo(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.closeOdoo(id, user, req.ip);
  }

  @Post(":id/close-thread")
  @Roles("admin", "gerente", "vendedor")
  closeThread(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.closeThread(id, user, req.ip);
  }

  @Post(":id/vouchers")
  @UseInterceptors(FileInterceptor("file", VOUCHER_UPLOAD))
  uploadVoucher(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { bank?: string; operationNumber?: string; paidAt?: string; declaredAmount?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.uploadVoucher(
      id,
      file,
      {
        bank: body.bank,
        operationNumber: body.operationNumber,
        paidAt: body.paidAt,
        declaredAmount: body.declaredAmount != null ? Number(body.declaredAmount) : undefined,
      },
      user,
      req.ip,
    );
  }

  @Post(":id/vouchers/:vid/verify")
  @Roles("admin", "gerente", "vendedor")
  verify(
    @Param("id") id: string,
    @Param("vid") vid: string,
    @Body() body: { note?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.verifyVoucher(id, vid, body.note || "", user, req.ip);
  }

  @Post(":id/vouchers/:vid/validate")
  @Roles("admin", "gerente", "vendedor")
  validate(@Param("id") id: string, @Param("vid") vid: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.validateVoucher(id, vid, user, req.ip);
  }

  @Post(":id/vouchers/:vid/reject")
  @Roles("admin", "gerente", "vendedor")
  reject(
    @Param("id") id: string,
    @Param("vid") vid: string,
    @Body() body: { motivo?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.rejectVoucher(id, vid, body.motivo || "", user, req.ip);
  }

  @Post(":id/extras/movement")
  @Roles("admin", "gerente", "vendedor")
  movement(
    @Param("id") id: string,
    @Body() body: { moves?: number; waive?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.addMovement(id, Number(body.moves) || 0, !!body.waive, user, req.ip);
  }

  @Post(":id/extras/freight")
  @Roles("admin", "gerente", "vendedor")
  freight(
    @Param("id") id: string,
    @Body() body: { zoneId?: string; vehicle?: string; sellAmount?: number; clientPickup?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.addFreight(id, body, user, req.ip);
  }

  @Post(":id/extras/service")
  @Roles("admin", "gerente", "vendedor")
  service(@Param("id") id: string, @Body() body: { serviceId?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.addService(id, body.serviceId || "", user, req.ip);
  }

  @Post(":id/extras/:eid/accept")
  accept(@Param("id") id: string, @Param("eid") eid: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.acceptExtra(id, eid, user, req.ip);
  }

  @Post(":id/assign")
  @Roles("admin", "gerente", "vendedor")
  assign(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.assign(id, user, req.ip);
  }

  @Post(":id/schedule")
  @Roles("admin", "gerente", "vendedor")
  schedule(
    @Param("id") id: string,
    @Body() body: { date?: string; notes?: string; depotId?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.schedule(id, body, user, req.ip);
  }

  @Post(":id/lost")
  @Roles("admin", "gerente", "vendedor")
  lost(@Param("id") id: string, @Body() body: { motivo?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.quotes.markLost(id, body.motivo || "", user, req.ip);
  }
}

@Controller("account")
@Roles("cliente")
export class AccountController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  profile(@CurrentUser() user: AuthUser) {
    return this.quotes.clientProfile(user);
  }

  @Get("quotes")
  mine(@CurrentUser() user: AuthUser) {
    return this.quotes.listForCustomer(user);
  }

  @Get("payment-accounts")
  banks() {
    return this.quotes.paymentAccounts();
  }

  @Put("profile")
  updateProfile(
    @Body() body: { companyName?: string; rucDni?: string; contactName?: string; phone?: string; email?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.quotes.updateClientProfile(user, body, req.ip);
  }

  @Post("ruc-lookup")
  lookupRuc(@Body() body: { ruc?: string }, @CurrentUser() user: AuthUser) {
    return this.quotes.lookupRuc(user, body.ruc || "");
  }
}

@Controller("admin")
@Roles("admin", "superadmin")
export class AdminOdooController {
  constructor(private readonly quotes: QuotesService) {}

  @Get("odoo-queue")
  queue() {
    return this.quotes.odooQueue();
  }

  @Post("odoo-queue/:id/retry")
  retry(@Param("id") id: string) {
    return this.quotes.retryQuoteIssue(id);
  }
}

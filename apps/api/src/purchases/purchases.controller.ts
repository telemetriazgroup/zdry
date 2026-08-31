import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { InvoiceLineInput, PurchasesService } from "./purchases.service";
import { MAX_PURCHASE_DOCS, MAX_PURCHASE_DOC_BYTES } from "../domain/purchase-docs";

@Controller("purchases")
@Roles("admin", "compras")
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get("meta")
  meta() {
    return this.purchases.meta();
  }

  @Get("badges")
  badges() {
    return this.purchases.badges();
  }

  @Get("iso")
  validateIso(@Query("code") code: string) {
    return this.purchases.validateIso(code || "");
  }

  @Get("invoices")
  invoices() {
    return this.purchases.listInvoices();
  }

  @Post("invoices")
  create(
    @Body()
    body: {
      number?: string;
      providerName?: string;
      incoterm?: string;
      logistics?: string;
      depotId?: string;
      extras?: Record<string, { enabled?: boolean }>;
      lines?: InvoiceLineInput[];
    },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.purchases.createInvoice(
      {
        number: body.number,
        providerName: body.providerName || "",
        incoterm: body.incoterm || "FOB",
        logistics: body.logistics || "reentrega",
        depotId: body.depotId || "",
        extras: body.extras,
        lines: body.lines || [],
      },
      user,
      req.ip,
    );
  }

  @Post("invoices/:id/documents")
  @UseInterceptors(
    FilesInterceptor("files", MAX_PURCHASE_DOCS, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PURCHASE_DOC_BYTES },
    }),
  )
  uploadDocuments(
    @Param("id") id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: { kinds?: string | string[] },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const list = files || [];
    if (!list.length) throw new BadRequestException("Selecciona al menos un archivo (PDF o imagen).");
    const kinds = Array.isArray(body.kinds) ? body.kinds : body.kinds ? [body.kinds] : [];
    return this.purchases.attachDocuments(
      id,
      list.map((f) => ({ buffer: f.buffer, originalname: f.originalname, size: f.size })),
      kinds,
      user,
      req.ip,
    );
  }

  @Get("documents/:id")
  async download(@Param("id") id: string) {
    const file = await this.purchases.openDocument(id);
    const ascii = file.originalName.replace(/[^\x20-\x7E]/g, "_");
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      disposition: `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      length: file.contentLength,
    });
  }

  @Get("extras")
  extras() {
    return this.purchases.pendingExtras();
  }

  @Get("dam")
  dam(@Query("done") done?: string) {
    return done === "1" ? this.purchases.damDone() : this.purchases.damPending();
  }

  @Post("dam")
  submitDam(
    @Body() body: { iso?: string; bl?: string; manifest?: string; damNumber?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.purchases.submitDam(
      {
        iso: body.iso || "",
        bl: body.bl || "",
        manifest: body.manifest || "",
        damNumber: body.damNumber || "",
      },
      user,
      req.ip,
    );
  }
}

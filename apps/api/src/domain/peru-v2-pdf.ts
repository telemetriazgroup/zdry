/** Render PDF Perú v2 (membrete ZGROUP) a partir de PeruV2Report. */

import Jimp from "jimp";
import { moneyReport, type PeruV2Report } from "./peru-v2-report";

const W = 595;
const H = 842;
const NAVY = "0.05 0.12 0.27";
const MUTED = "0.35 0.38 0.42";

const WINANSI: Record<number, number> = {
  0x2014: 0x97, 0x2013: 0x96, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x00e1: 0xe1, 0x00e9: 0xe9, 0x00ed: 0xed, 0x00f3: 0xf3, 0x00fa: 0xfa, 0x00f1: 0xf1,
  0x00c1: 0xc1, 0x00c9: 0xc9, 0x00cd: 0xcd, 0x00d3: 0xd3, 0x00da: 0xda, 0x00d1: 0xd1,
  0x00fc: 0xfc, 0x00dc: 0xdc,
};

function pdfStr(s: string): string {
  let out = "";
  const t = String(s ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    if (code < 128) out += t[i];
    else if (WINANSI[code]) out += String.fromCharCode(WINANSI[code]);
    else if (code < 256) out += t[i];
    else out += "?";
  }
  return out;
}

function T(x: number, y: number, size: number, text: string, opts?: { bold?: boolean; color?: string }): string {
  const font = opts?.bold ? "/F2" : "/F1";
  const color = opts?.color || "0 0 0";
  return `BT ${font} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${pdfStr(text)}) Tj ET\n`;
}

function textWidth(s: string, size: number): number {
  return String(s || "").length * size * 0.5;
}

function Tright(xRight: number, y: number, size: number, text: string, opts?: { bold?: boolean; color?: string }): string {
  return T(xRight - textWidth(text, size), y, size, text, opts);
}

function iconDot(x: number, y: number): string {
  return `${NAVY} rg ${x.toFixed(1)} ${y.toFixed(1)} 2.2 2.2 re f\n`;
}

function rect(x: number, y: number, w: number, h: number, rgb: string): string {
  return `${rgb} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f\n`;
}

function rule(x1: number, y: number, x2: number): string {
  return `0.4 w 0.75 0.78 0.82 RG ${x1.toFixed(1)} ${y.toFixed(1)} m ${x2.toFixed(1)} ${y.toFixed(1)} l S\n`;
}

function wrap(text: string, max: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function logoToRgb(png: Buffer): Promise<{ w: number; h: number; rgb: Buffer } | null> {
  try {
    const img = await Jimp.read(png);
    img.contain(420, 160, Jimp.HORIZONTAL_ALIGN_LEFT | Jimp.VERTICAL_ALIGN_MIDDLE);
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    const rgb = Buffer.alloc(w * h * 3);
    const src = img.bitmap.data;
    for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
      const a = src[i + 3] / 255;
      rgb[j] = Math.round(src[i] * a + 255 * (1 - a));
      rgb[j + 1] = Math.round(src[i + 1] * a + 255 * (1 - a));
      rgb[j + 2] = Math.round(src[i + 2] * a + 255 * (1 - a));
    }
    return { w, h, rgb };
  } catch {
    return null;
  }
}

function assemble(content: string, image?: { w: number; h: number; rgb: Buffer } | null): Buffer {
  const xobj = image ? " /XObject << /Im1 7 0 R >>" : "";
  const bodies: Array<string | Buffer> = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${xobj} >> /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const off = [0];
  let len = parts[0].length;
  const writeObj = (n: number, body: string | Buffer) => {
    off[n] = len;
    if (Buffer.isBuffer(body)) {
      const head = Buffer.from(`${n} 0 obj\n`, "latin1");
      const tail = Buffer.from(`\nendobj\n`, "latin1");
      parts.push(head, body, tail);
      len += head.length + body.length + tail.length;
      return;
    }
    const chunk = Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, "latin1");
    parts.push(chunk);
    len += chunk.length;
  };
  bodies.forEach((b, i) => writeObj(i + 1, b));
  if (image) {
    const imgObj = Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.rgb.length} >>\nstream\n`,
        "latin1",
      ),
      image.rgb,
      Buffer.from(`\nendstream`, "latin1"),
    ]);
    writeObj(7, imgObj);
  }
  const xref = len;
  const count = image ? 8 : 7;
  let xrefBlock = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) xrefBlock += `${String(off[i]).padStart(10, "0")} 00000 n \n`;
  xrefBlock += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  parts.push(Buffer.from(xrefBlock, "latin1"));
  return Buffer.concat(parts);
}

export async function renderPeruV2Pdf(report: PeruV2Report, logoPng?: Buffer | null): Promise<Buffer> {
  const logo = logoPng ? await logoToRgb(logoPng) : null;
  const ops: string[] = [];
  const right = W - 36;
  let logoBottom = H - 78;
  if (logo) {
    const dw = 128;
    const dh = (logo.h / logo.w) * dw;
    const logoY = H - 32 - dh;
    ops.push(`q ${dw.toFixed(1)} 0 0 ${dh.toFixed(1)} 36 ${logoY.toFixed(1)} cm /Im1 Do Q\n`);
    logoBottom = logoY - 4;
  }
  if (report.letterhead.tagline) {
    ops.push(T(36, logoBottom - 8, 6, report.letterhead.tagline, { color: MUTED }));
  }
  ops.push(Tright(right, H - 36, 9, report.letterhead.slogan, { bold: true, color: NAVY }));
  ops.push(Tright(right, H - 50, 8, `${report.letterhead.name} - RUC: ${report.letterhead.vat}`, { color: MUTED }));
  ops.push(Tright(right, H - 62, 8, report.letterhead.address, { color: MUTED }));

  let y = H - 128;
  ops.push(Tright(right, y, 10, report.customerName, { bold: true }));
  y -= 14;
  const blockX = 318;
  if (report.customerAddress) {
    const addr = wrap(report.customerAddress, 46);
    ops.push(iconDot(blockX, y + 1));
    ops.push(T(blockX + 8, y, 8, addr[0] || "", { color: MUTED }));
    y -= 11;
    for (const extra of addr.slice(1)) {
      ops.push(T(blockX + 8, y, 8, extra, { color: MUTED }));
      y -= 11;
    }
  }
  if (report.customerPhone) {
    ops.push(iconDot(blockX, y + 1));
    ops.push(T(blockX + 8, y, 8, report.customerPhone, { color: MUTED }));
    y -= 11;
  }
  if (report.customerEmail) {
    ops.push(iconDot(blockX, y + 1));
    ops.push(T(blockX + 8, y, 8, report.customerEmail, { color: MUTED }));
    y -= 11;
  }
  if (report.contactName) {
    ops.push(T(blockX, y, 8, `Contacto: ${report.contactName}`));
    y -= 11;
    if (report.contactPhone) {
      ops.push(iconDot(blockX, y + 1));
      ops.push(T(blockX + 8, y, 8, report.contactPhone, { color: MUTED }));
      y -= 11;
    }
  }
  if (report.customerVat) {
    ops.push(T(blockX, y, 8, `VAT: ${report.customerVat}`, { bold: true }));
    y -= 16;
  }

  y = Math.min(y, H - 248);
  ops.push(T(36, y, 18, `COTIZACIÓN N°: ${report.saleName}`, { bold: true, color: NAVY }));
  y -= 22;
  ops.push(T(36, y, 8, "Referencia:", { color: MUTED }));
  ops.push(T(130, y, 8, "Fecha de presupuesto:", { color: MUTED }));
  ops.push(T(280, y, 8, "Validez de la oferta:", { color: MUTED }));
  ops.push(T(430, y, 8, "Comercial:", { color: MUTED }));
  y -= 12;
  ops.push(T(36, y, 9, report.reference, { bold: true }));
  ops.push(T(130, y, 9, report.quoteDate, { bold: true }));
  ops.push(T(280, y, 9, report.validUntil, { bold: true }));
  ops.push(T(430, y, 9, report.commercial || "—", { bold: true }));
  y -= 18;

  ops.push(rect(36, y - 4, W - 72, 16, NAVY));
  ops.push(T(40, y, 8, report.asunto, { bold: true, color: "1 1 1" }));
  y -= 20;
  ops.push(rect(36, y - 4, W - 72, 14, NAVY));
  ops.push(T(40, y, 7, "N", { bold: true, color: "1 1 1" }));
  ops.push(T(58, y, 7, "DESCRIPCIÓN", { bold: true, color: "1 1 1" }));
  ops.push(T(360, y, 7, "PRECIO UNIT", { bold: true, color: "1 1 1" }));
  ops.push(T(445, y, 7, "CANT", { bold: true, color: "1 1 1" }));
  ops.push(T(495, y, 7, "PRECIO FINAL", { bold: true, color: "1 1 1" }));
  y -= 16;
  for (const line of report.lines) {
    const desc = wrap(`${line.iso ? `${line.iso} - ` : ""}${line.description.replace(new RegExp(`^${line.iso}\\s*[-–·]\\s*`), "")}`, 50);
    ops.push(T(40, y, 8, String(line.n)));
    ops.push(T(58, y, 8, desc[0] || ""));
    ops.push(T(360, y, 8, moneyReport(line.priceUnit)));
    ops.push(T(450, y, 8, moneyReport(line.qty)));
    ops.push(T(500, y, 8, `$ ${moneyReport(line.priceFinal)}`, { bold: true }));
    y -= 11;
    for (const extra of desc.slice(1)) {
      ops.push(T(58, y, 8, extra));
      y -= 11;
    }
    ops.push(rule(36, y + 6, W - 36));
    y -= 6;
    if (y < 220) break;
  }

  y -= 8;
  ops.push(T(36, y, 8, `Precio: ${report.taxNote}`));
  ops.push(T(320, y, 8, `Tiempo de entrega: ${report.deliveryTime}`));
  y -= 12;
  ops.push(T(36, y, 8, `Forma de pago: ${report.paymentTerm}`));
  ops.push(T(320, y, 8, `Lugar de entrega: ${report.deliveryPlace}`));
  y -= 12;
  ops.push(T(36, y, 8, `Tipo de moneda: ${report.currencyLabel}`));
  ops.push(T(320, y, 8, `Validez de la Oferta: ${report.validityLabel}`));
  y -= 20;

  ops.push(rect(36, y - 4, W - 72, 14, NAVY));
  ops.push(T(40, y, 8, "CUENTAS CORRIENTES ZGROUP", { bold: true, color: "1 1 1" }));
  y -= 16;
  ops.push(T(40, y, 7, "TIPO DE CUENTA", { bold: true, color: MUTED }));
  ops.push(T(140, y, 7, "BANCO - MONEDA", { bold: true, color: MUTED }));
  ops.push(T(390, y, 7, "NRO CUENTA / INTERBANCARIA", { bold: true, color: MUTED }));
  y -= 12;
  for (const b of report.letterhead.banks) {
    ops.push(T(40, y, 7, b.kind));
    ops.push(T(140, y, 7, b.bank.length > 42 ? `${b.bank.slice(0, 40)}…` : b.bank));
    ops.push(T(390, y, 7, b.account));
    y -= 11;
    if (y < 90) break;
  }

  y -= 8;
  for (const line of report.note.split("\n")) {
    if (y < 48) break;
    ops.push(T(36, y, 7, line, { color: MUTED }));
    y -= 10;
  }
  y -= 4;
  ops.push(T(36, y, 8, `Payment terms: ${report.paymentTerm}`, { color: MUTED }));

  return assemble(ops.join(""), logo);
}

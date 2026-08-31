/** PDF de cotización — generador propio (prototipo HTML, sin librerías). */

import { grossOf, igvOf, moneyUsd } from "./pricing";

const PDF_WINANSI_MAP: Record<number, number> = {
  0x2014: 0x97, 0x2013: 0x96, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x20ac: 0x80,
};

function pdfStr(s: string): string {
  let out = "";
  const t = String(s ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    if (code < 256) out += t[i];
    else if (PDF_WINANSI_MAP[code]) out += String.fromCharCode(PDF_WINANSI_MAP[code]);
    else out += "?";
  }
  return out;
}

function pdfText(x: number, y: number, size: number, text: string, opts?: { bold?: boolean; color?: string }): string {
  const font = opts?.bold ? "/F2" : "/F1";
  const color = opts?.color || "0 0 0";
  return `BT ${font} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfStr(text)}) Tj ET\n`;
}

function pdfLine(x1: number, y1: number, x2: number, y2: number): string {
  return `0.6 w 0.85 0.87 0.9 RG\n${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
}

function pdfRectFill(x: number, y: number, w: number, h: number, color: string): string {
  return `${color} rg\n${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`;
}

function buildPdf(pageWidth: number, pageHeight: number, contentOps: string[]): string {
  const content = contentOps.join("");
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  ];
  let pdf = "%PDF-1.4\n";
  const off = [0];
  objs.forEach((body, i) => {
    off.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) pdf += String(off[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}

export function buildQuotePdf(input: {
  number: string;
  vendorName: string;
  customerName: string;
  customerDoc: string;
  customerEmail: string;
  customerPhone: string;
  units: { iso: string; typeLabel: string; catLabel: string; priceNet: number | null }[];
  extras: { label: string; amount: number }[];
}): Buffer {
  const W = 612, H = 792;
  const ops: string[] = [];
  ops.push(pdfRectFill(0, H - 70, W, 70, "0.071 0.125 0.227"));
  ops.push(pdfText(36, H - 38, 20, "ZDRY", { bold: true, color: "1 1 1" }));
  ops.push(pdfText(105, H - 38, 10, "El supermercado de contenedores", { color: "0.78 0.81 0.87" }));
  const emit = new Date();
  const valid = new Date(emit.getTime() + 5 * 86400000);
  ops.push(pdfText(W - 260, H - 28, 9, "Cotizacion N. " + input.number, { color: "1 1 1" }));
  ops.push(pdfText(W - 260, H - 41, 9, "Emitida: " + emit.toLocaleDateString("es-PE"), { color: "1 1 1" }));
  ops.push(pdfText(W - 260, H - 54, 9, "Valida hasta: " + valid.toLocaleDateString("es-PE"), { bold: true, color: "1 1 1" }));
  let y = H - 100;
  ops.push(pdfText(36, y, 11, "Cliente: " + input.customerName + "  ·  " + input.customerDoc, { bold: true }));
  y -= 15;
  ops.push(pdfText(36, y, 10, "Contacto: " + input.customerEmail + "  ·  " + input.customerPhone));
  y -= 15;
  ops.push(pdfText(36, y, 10, "Asesor: " + (input.vendorName || "—")));
  y -= 26;
  const cols: [string, number][] = [["ISO", 36], ["Tipo", 130], ["Condicion", 250], ["Neto", 370], ["IGV 18%", 450], ["Total", 530]];
  ops.push(pdfRectFill(36, y - 4, W - 72, 18, "0.957 0.961 0.969"));
  cols.forEach((c) => ops.push(pdfText(c[1] + 4, y, 9, c[0], { bold: true })));
  y -= 18;
  ops.push(pdfLine(36, y, W - 36, y));
  let totalNet = 0;
  for (const u of input.units) {
    y -= 20;
    if (y < 130) break;
    ops.push(pdfText(cols[0][1] + 4, y, 9, u.iso));
    ops.push(pdfText(cols[1][1] + 4, y, 9, u.typeLabel));
    ops.push(pdfText(cols[2][1] + 4, y, 9, u.catLabel));
    if (u.priceNet == null) {
      ops.push(pdfText(cols[3][1] + 4, y, 9, "A confirmar por asesor", { color: "0.5 0.5 0.5" }));
    } else {
      const igv = igvOf(u.priceNet);
      ops.push(pdfText(cols[3][1] + 4, y, 9, moneyUsd(u.priceNet)));
      ops.push(pdfText(cols[4][1] + 4, y, 9, moneyUsd(igv)));
      ops.push(pdfText(cols[5][1] + 4, y, 9, moneyUsd(u.priceNet + igv), { bold: true }));
      totalNet += u.priceNet;
    }
    ops.push(pdfLine(36, y - 6, W - 36, y - 6));
  }
  for (const e of input.extras) {
    y -= 16;
    if (y < 90) break;
    ops.push(pdfText(36, y, 9, e.label));
    ops.push(pdfText(530, y, 9, moneyUsd(e.amount), { bold: true }));
    totalNet += e.amount;
  }
  y -= 22;
  const totalIgv = igvOf(totalNet);
  ops.push(pdfText(400, y, 10, "Subtotal neto: " + moneyUsd(totalNet)));
  y -= 15;
  ops.push(pdfText(400, y, 10, "IGV (18%): " + moneyUsd(totalIgv)));
  y -= 17;
  ops.push(pdfText(400, y, 13, "Total: " + moneyUsd(grossOf(totalNet)), { bold: true }));
  y -= 36;
  ops.push(pdfText(36, y, 8, "Cotizacion referencial, sujeta a disponibilidad de patio. Precios en USD.", { color: "0.55 0.55 0.55" }));
  y -= 11;
  ops.push(pdfText(36, y, 8, "Documento generado automaticamente — no constituye comprobante de pago.", { color: "0.55 0.55 0.55" }));
  const pdfString = buildPdf(W, H, ops);
  return Buffer.from(pdfString, "binary");
}

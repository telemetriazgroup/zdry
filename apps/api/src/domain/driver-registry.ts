import { inflateRawSync } from "zlib";
import { displayPlate } from "./gate-visit";

export const LIVE_STATUSES = ["REGISTRADO", "EN ATENCION", "FINALIZADO", "CANCELADO"] as const;
export const CONFIRM_TEMPLATE_KEY = "visit_confirm_template";
export const LOCATION_TEMPLATE_KEY = "visit_location_template";

export const DEFAULT_CONFIRM_TEMPLATE = [
  "Hola, *{conductor}*.",
  "",
  "Su registro para *{motivo}* ha sido recibido.",
  "En breve nos pondremos en contacto contigo.",
  "",
  "Saludos.",
].join("\n");

export const DEFAULT_LOCATION_TEMPLATE = [
  "Hola, *{conductor}*.",
  "",
  "Puede dirigirse a nuestro almacén *{almacen}* para *{motivo}*.",
  "",
  "*Ubicación:* {mapa}",
  "",
  "Saludos.",
].join("\n");

export const LIMA_EMAILS = [
  "asistente_operaciones@zgroup.com.pe",
  "operaciones@zgroup.com.pe",
  "mzabarburu@zgroup.com.pe",
];

export const LIMA_WAREHOUSES = [
  { name: "Gambeta 1", mapUrl: "https://maps.app.goo.gl/LaQNc1TTT3Svk6bYA" },
  { name: "Gambeta 2", mapUrl: "https://maps.app.goo.gl/ZqawyDSRAunNbde5A?g_st=ipc" },
];

export const SEED_MOTIVES = [
  { name: "Cargar contenedor", asksDetail: false },
  { name: "Descargar contenedor", asksDetail: false },
  { name: "Mantenimiento o reparación", asksDetail: false },
  { name: "Almacenaje", asksDetail: false },
  { name: "Otros", asksDetail: true },
];

const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;

export function statusLabel(status: string) {
  if (status === "EN ATENCION") return "EN ATENCIÓN";
  return status || "";
}

export function normalizeStatus(raw: string): string | null {
  const t = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/Á/g, "A")
    .replace(/É/g, "E")
    .replace(/Í/g, "I")
    .replace(/Ó/g, "O")
    .replace(/Ú/g, "U");
  if (t === "REGISTRADO" || t === "EN ATENCION" || t === "FINALIZADO" || t === "CANCELADO" || t === "ANULADO") return t;
  return null;
}

export function isLiveStatus(status: string) {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

export function limaParts(date: Date) {
  const wall = new Date(date.getTime() - LIMA_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    y: String(wall.getUTCFullYear()),
    m: pad(wall.getUTCMonth() + 1),
    d: pad(wall.getUTCDate()),
    hh: pad(wall.getUTCHours()),
    mm: pad(wall.getUTCMinutes()),
    ss: pad(wall.getUTCSeconds()),
  };
}

export function formatPublicCode(date: Date) {
  const p = limaParts(date);
  return `ZG-${p.y}${p.m}${p.d}-${p.hh}${p.mm}${p.ss}`;
}

export function formatLimaStamp(date: Date) {
  const p = limaParts(date);
  return `${p.d}/${p.m}/${p.y} ${p.hh}:${p.mm}:${p.ss}`;
}

export function equipmentIsoWarning(code: string) {
  const raw = String(code || "").trim();
  if (!raw) return "";
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{4}\d{7}$/.test(compact)) return "";
  return "No cumple la norma ISO";
}

export function motiveForMessage(motive: string, detail: string) {
  const name = String(motive || "").trim();
  const extra = String(detail || "").trim();
  if (!extra) return name;
  if (name.toUpperCase().startsWith("OTROS")) {
    return extra.toUpperCase().startsWith("OTROS") ? extra : `OTROS - ${extra}`;
  }
  return `${name} - ${extra}`;
}

export function fillTemplate(template: string, vars: Record<string, string>) {
  return String(template || "").replace(/\{(conductor|motivo|almacen|mapa)\}/g, (_, key: string) => vars[key] || "");
}

export function digitsFromExcel(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/e/i.test(raw) && /^[0-9.eE+-]+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw.replace(/\D/g, "");
    return Math.round(n).toString();
  }
  if (/^\d+\.0+$/.test(raw)) return raw.split(".")[0];
  return raw.replace(/\D/g, "");
}

export function excelText(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d+\.0+$/.test(raw)) return raw.split(".")[0];
  if (/e/i.test(raw) && /^[0-9.eE+-]+$/.test(raw)) return digitsFromExcel(raw);
  return raw;
}

export function excelDate(serial: string, fraction: string) {
  const day = Number(serial);
  const frac = Number(fraction || 0);
  if (!Number.isFinite(day)) return new Date();
  const wallMs = Date.UTC(1899, 11, 30) + Math.round((day + (Number.isFinite(frac) ? frac : 0)) * 86400000);
  return new Date(wallMs + LIMA_OFFSET_MS);
}

export function parseVisitWhen(dateRaw: string, timeRaw: string): Date | null {
  const date = String(dateRaw || "").trim();
  const time = String(timeRaw || "").trim();
  if (/^\d+(\.\d+)?$/.test(date)) {
    const fraction = /^\d+(\.\d+)?$/.test(time) && Number(time) < 2 ? time : "0";
    return excelDate(date, fraction);
  }
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(date);
  if (!match) return null;
  let hh = 0;
  let mm = 0;
  let ss = 0;
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (clock) {
    hh = Number(clock[1]);
    mm = Number(clock[2]);
    ss = Number(clock[3] || 0);
  } else if (/^\d+(\.\d+)?$/.test(time) && Number(time) < 2) {
    const total = Math.round(Number(time) * 86400);
    hh = Math.floor(total / 3600);
    mm = Math.floor((total % 3600) / 60);
    ss = total % 60;
  }
  const wall = Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hh, mm, ss);
  return new Date(wall + LIMA_OFFSET_MS);
}

function esc(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type NoticePack = {
  subject: string;
  text: string;
  html: string;
  whatsapp: string;
};

export function registryNotice(input: {
  site: string;
  motive: string;
  when: Date;
  tractorPlate: string;
  trailerPlate: string;
  driverName: string;
  company: string;
  ruc: string;
  license: string;
  phone: string;
  equipmentCode: string;
  status: string;
  observations: string;
  publicCode: string;
}): NoticePack {
  const rows: Array<[string, string]> = [
    ["Sede", input.site],
    ["Motivo de visita", input.motive],
    ["Fecha y hora", formatLimaStamp(input.when)],
    ["Placa tracto", input.tractorPlate],
    ["Placa carreta", input.trailerPlate],
    ["Conductor", input.driverName],
    ["Empresa", input.company],
    ["RUC", input.ruc],
    ["Brevete", input.license],
    ["Teléfono", input.phone],
    ["Código de equipo", input.equipmentCode || "NO INDICADO"],
    ["Estado", statusLabel(input.status)],
    ["Observaciones", input.observations || "SIN OBSERVACIONES"],
    ["ID de registro", input.publicCode],
  ];
  const subject = `[${input.site.toUpperCase()}] ${input.motive.toUpperCase()} | ${input.tractorPlate}`.slice(0, 180);
  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n").slice(0, 8000);
  const whatsapp = ["*ZGROUP*", "Nuevo registro de conductor", "", ...rows.map(([label, value]) => `*${label}:* ${value}`)]
    .join("\n")
    .slice(0, 4000);
  const body = rows.map(([label, value]) => (
    `<tr><td style="padding:8px 10px;border-bottom:1px solid #e2e4ea;color:#5c6370;font-size:13px;width:160px;">${esc(label)}</td><td style="padding:8px 10px;border-bottom:1px solid #e2e4ea;color:#12203a;font-size:14px;font-weight:700;">${esc(value)}</td></tr>`
  )).join("");
  const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e2e4ea;">
<tr><td style="background:#12203a;padding:22px 28px;color:#ffffff;">
<div style="font-size:13px;letter-spacing:0.18em;font-weight:700;">ZGROUP</div>
<div style="font-size:20px;font-weight:700;margin-top:8px;">NUEVO REGISTRO DE CONDUCTOR</div>
<div style="font-size:12px;letter-spacing:0.12em;margin-top:4px;color:#d7deea;">CONTROL DE INGRESO</div>
</td></tr>
<tr><td style="padding:8px 18px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>
</table></td></tr></table></body></html>`.slice(0, 20000);
  return { subject, text, html, whatsapp };
}

export function htmlSalidaUrl(url: string) {
  const clean = String(url || "").trim().replace(/\/+$/, "");
  if (clean.endsWith("/salida")) return `${clean}-registro`;
  return `${clean}-registro`;
}

export type PublicInput = {
  siteId?: string;
  motiveId?: string;
  motiveDetail?: string;
  company?: string;
  ruc?: string;
  driverName?: string;
  license?: string;
  phone?: string;
  tractorPlate?: string;
  trailerPlate?: string;
  equipmentCode?: string;
  observations?: string;
};

export function validatePublicInput(input: PublicInput) {
  const siteId = String(input.siteId || "").trim();
  const motiveId = String(input.motiveId || "").trim();
  const company = String(input.company || "").trim().slice(0, 160);
  const driverName = String(input.driverName || "").trim().slice(0, 160);
  const license = String(input.license || "").trim().slice(0, 40);
  const ruc = String(input.ruc || "").replace(/\D/g, "");
  const phone = String(input.phone || "").replace(/\D/g, "");
  const tractorPlate = displayPlate(input.tractorPlate || "");
  const trailerPlate = displayPlate(input.trailerPlate || "");
  const equipmentCode = String(input.equipmentCode || "").trim().slice(0, 40);
  const observations = String(input.observations || "").trim().slice(0, 500);
  const motiveDetail = String(input.motiveDetail || "").trim().slice(0, 160);
  if (!siteId) return { ok: false as const, message: "Selecciona una sede." };
  if (!motiveId) return { ok: false as const, message: "Selecciona el motivo de visita." };
  if (company.length < 2) return { ok: false as const, message: "Indica la empresa." };
  if (!/^\d{11}$/.test(ruc)) return { ok: false as const, message: "El RUC tiene 11 dígitos." };
  if (driverName.length < 3) return { ok: false as const, message: "Indica los nombres y apellidos." };
  if (license.length < 3) return { ok: false as const, message: "Indica el número de brevete." };
  if (!/^\d{9}$/.test(phone)) return { ok: false as const, message: "El teléfono tiene 9 dígitos." };
  if (tractorPlate.length < 3) return { ok: false as const, message: "Indica la placa del tracto." };
  if (trailerPlate.length < 3) return { ok: false as const, message: "Indica la placa de la carreta." };
  return {
    ok: true as const,
    value: { siteId, motiveId, company, ruc, driverName, license, phone, tractorPlate, trailerPlate, equipmentCode, observations, motiveDetail },
  };
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

export function parseSharedStrings(xml: string) {
  const out: string[] = [];
  for (const chunk of xml.split(/<si[\s>]/).slice(1)) {
    const body = chunk.split("</si>")[0];
    const texts = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
    out.push(texts.join(""));
  }
  return out;
}

export function parseSheetRows(xml: string, strings: string[]) {
  const rows: Record<string, string>[] = [];
  for (const part of xml.split(/<row[\s>]/).slice(1)) {
    const chunk = part.split("</row>")[0];
    const rec: Record<string, string> = {};
    for (const cell of chunk.split(/<c[\s>]/).slice(1)) {
      const headEnd = cell.indexOf(">");
      const head = headEnd >= 0 ? cell.slice(0, headEnd) : cell;
      const ref = /r="([A-Z]+)\d+"/.exec(head);
      if (!ref) continue;
      const type = /t="([^"]+)"/.exec(head)?.[1] || "";
      const body = cell.split("</c>")[0];
      const direct = /<v>([\s\S]*?)<\/v>/.exec(body);
      let val = direct ? decodeXml(direct[1]) : [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
      if (type === "s") val = strings[Number(val)] || "";
      rec[ref[1]] = val;
    }
    rows.push(rec);
  }
  return rows;
}

export function unzipXlsx(buf: Buffer) {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no es un Excel válido.");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("El archivo no es un Excel válido.");
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    if (method === 0) out.set(name, comp);
    else if (method === 8) out.set(name, inflateRawSync(comp));
    else throw new Error("El Excel usa una compresión no soportada.");
  }
  return out;
}

export function readXlsxSheets(buf: Buffer) {
  const files = unzipXlsx(buf);
  const wb = files.get("xl/workbook.xml")?.toString("utf8") || "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const strings = parseSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1] || "";
    const target = /Target="([^"]+)"/.exec(m[1])?.[1] || "";
    if (id && target) relMap.set(id, target);
  }
  const sheets: Array<{ name: string; rows: Record<string, string>[] }> = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const name = decodeXml(/name="([^"]+)"/.exec(attrs)?.[1] || "");
    const rid = /r:id="([^"]+)"/.exec(attrs)?.[1] || "";
    if (!name || !rid) continue;
    let target = relMap.get(rid) || "";
    if (target.startsWith("/")) target = target.slice(1);
    if (target && !target.startsWith("xl/")) target = `xl/${target.replace(/^\.\//, "")}`;
    const xml = files.get(target)?.toString("utf8") || "";
    sheets.push({ name, rows: parseSheetRows(xml, strings) });
  }
  return sheets;
}

export type ImportedRegistration = {
  publicCode: string;
  siteName: string;
  visitAt: Date;
  company: string;
  ruc: string;
  driverName: string;
  license: string;
  phone: string;
  tractorPlate: string;
  trailerPlate: string;
  motive: string;
  equipmentCode: string;
  status: string;
  observations: string;
};

export function registrationRows(sheets: Array<{ name: string; rows: Record<string, string>[] }>) {
  const rows: ImportedRegistration[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const sheet of sheets) {
    const key = sheet.name.trim().toUpperCase();
    const siteName = key === "REGISTROS" ? "Lima" : key === "PIURA" ? "Piura" : "";
    if (!siteName) continue;
    for (const row of sheet.rows) {
      const rawId = String(row.A || "").trim();
      if (/^(id|fecha|empresa|registro)$/i.test(rawId)) continue;
      if (rawId.toUpperCase().startsWith("ZG-EJEMPLO")) {
        skipped.push({ id: rawId, reason: "Fila de ejemplo. Bórrala antes de asimilar." });
        continue;
      }
      const tractorPlate = displayPlate(excelText(row.I || ""));
      const visitAt = parseVisitWhen(row.B || "", row.C || "");
      let id = rawId;
      if (!id.startsWith("ZG-")) {
        if (tractorPlate.length < 3 || !excelText(row.F || "")) continue;
        if (!visitAt) {
          skipped.push({ id: tractorPlate, reason: "Falta la fecha para asignar el id." });
          continue;
        }
        id = formatPublicCode(visitAt);
      }
      if (seen.has(id)) {
        skipped.push({ id, reason: "El id ya apareció en el archivo." });
        continue;
      }
      seen.add(id);
      const typedStatus = String(row.M || "").trim();
      let status = normalizeStatus(typedStatus);
      if (!status && !typedStatus && !rawId.startsWith("ZG-")) status = "REGISTRADO";
      if (!status) {
        skipped.push({ id, reason: "El estado no es válido." });
        continue;
      }
      if (tractorPlate.length < 3) {
        skipped.push({ id, reason: "Falta la placa del tracto." });
        continue;
      }
      rows.push({
        publicCode: id.slice(0, 40),
        siteName,
        visitAt: visitAt || new Date(),
        company: excelText(row.D || "").slice(0, 160),
        ruc: digitsFromExcel(row.E || "").slice(0, 20),
        driverName: excelText(row.F || "").slice(0, 160),
        license: excelText(row.G || "").slice(0, 40),
        phone: digitsFromExcel(row.H || "").slice(0, 20),
        tractorPlate,
        trailerPlate: displayPlate(excelText(row.J || "")),
        motive: excelText(row.K || "").slice(0, 160),
        equipmentCode: excelText(row.L || "").slice(0, 40),
        status,
        observations: excelText(row.N || "").slice(0, 500),
      });
    }
  }
  return { rows, skipped };
}

const TEMPLATE_HEADERS = [
  "ID", "FECHA", "HORA", "EMPRESA", "RUC", "CONDUCTOR", "BREVETE", "TELEFONO",
  "PLACA DE TRACTO", "PLACA DE CARRETA", "MOTIVO DE VISITA", "CODIGO DE EQUIPO", "ESTADO", "OBSERVACIONES",
];

function sheetXml(rows: string[][]) {
  const body = rows.map((row, index) => {
    const cells = row.map((value, col) => {
      const ref = `${String.fromCharCode(65 + col)}${index + 1}`;
      const text = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
    }).join("");
    return `<row r="${index + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function crc32(buf: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries: Array<{ name: string; data: Buffer }>) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, entry.data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(entry.data.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

export function buildRegistryTemplate() {
  const lima = sheetXml([
    ["REGISTRO DE CONDUCTORES", "LIMA"],
    ["Una fila por ingreso. Borra la fila de ejemplo. Si el ID va vacío, ZDRY lo asigna con la fecha y la hora. Esta carga no envía correo ni WhatsApp."],
    TEMPLATE_HEADERS,
    ["ZG-EJEMPLO-000000", "10/11/2026", "09:56:08", "LH TRADE", "20545385296", "DOMINGO CHUCO CAPCHA", "21106707", "954124973", "CYB.476", "A8F974", "CARGAR CONTENEDOR", "", "FINALIZADO", ""],
  ]);
  const piura = sheetXml([
    ["REGISTRO DE CONDUCTORES", "PIURA"],
    ["Misma tabla que Lima. Esta hoja entra como sede Piura."],
    TEMPLATE_HEADERS,
  ]);
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="REGISTROS" sheetId="1" r:id="rId1"/><sheet name="PIURA" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(types) },
    { name: "_rels/.rels", data: Buffer.from(root) },
    { name: "xl/workbook.xml", data: Buffer.from(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(rels) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(lima) },
    { name: "xl/worksheets/sheet2.xml", data: Buffer.from(piura) },
  ]);
}

import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { publicUrl } from "./api.js";

export const VISIT_FIELDS = [
  ["publicCode", "Registro"],
  ["siteName", "Sede"],
  ["status", "Estado"],
  ["tractorPlate", "Placa tracto"],
  ["trailerPlate", "Placa carreta"],
  ["driverName", "Conductor"],
  ["company", "Empresa"],
  ["ruc", "RUC"],
  ["license", "Brevete"],
  ["phone", "Teléfono"],
  ["motive", "Motivo"],
  ["equipmentCode", "Código de equipo"],
  ["observations", "Observaciones"],
];

export function motiveLabel(motive) {
  if (motive === "cargar") return "Cargar contenedor";
  if (motive === "descargar") return "Descargar contenedor";
  return motive || "—";
}

export function statusLabel(status) {
  if (status === "EN ATENCION") return "EN ATENCIÓN";
  return status || "REGISTRADO";
}

export function formatVisitWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).replace("T", " ").slice(0, 16);
  return d.toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function visitFieldValue(key, data) {
  if (key === "motive") return motiveLabel(data.motive);
  if (key === "status") return statusLabel(data.status);
  if (key === "visitAt") return formatVisitWhen(data.visitAt);
  if (key === "equipmentCode") return data.equipmentCode || "NO INDICADO";
  if (key === "observations") return data.observations || "SIN OBSERVACIONES";
  if (key === "phone") {
    const digits = String(data.phone || "").replace(/\D/g, "");
    const local = digits.startsWith("51") && digits.length > 9 ? digits.slice(2, 11) : digits.slice(0, 9);
    return local ? `+51 ${local}` : "—";
  }
  return data[key] || "—";
}

export function shortVisitCode(token) {
  return String(token || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function visitTicketHref(token) {
  if (typeof window === "undefined") return publicUrl(`/visita/${token}`);
  return `${window.location.origin}${publicUrl(`/visita/${token}`)}`;
}

async function asDataUrl(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function imageFormat(dataUrl) {
  if (String(dataUrl).startsWith("data:image/png")) return "PNG";
  if (String(dataUrl).startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

export async function downloadVisitPdf(visit, photoUrl) {
  const token = visit.publicToken;
  const url = visitTicketHref(token);
  const code = visit.publicCode || shortVisitCode(token);
  const [logo, qr, photo] = await Promise.all([
    asDataUrl(publicUrl("/brand/zg_marca.png")),
    QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: "M" }),
    photoUrl ? asDataUrl(photoUrl).catch(() => null) : Promise.resolve(null),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.addImage(logo, "PNG", 12, 10, 72, 24);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(18, 32, 58);
  doc.text("Registro de conductores", 16, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(70, 78, 90);
  const who = visit.driverName?.trim() || "conductor";
  doc.text(`Bienvenido, ${who}.`, 16, 52);

  let y = 66;
  doc.setFontSize(11);
  for (const [key, label] of VISIT_FIELDS) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(18, 32, 58);
    doc.text(label, 16, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 48, 60);
    doc.text(String(visitFieldValue(key, visit)), 62, y, { maxWidth: 70 });
    y += 7;
  }

  doc.addImage(qr, "PNG", 140, 42, 52, 52);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Validación", 140, 100);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(code, 140, 107);
  doc.setFontSize(8);
  doc.setTextColor(90, 98, 110);
  doc.text(url, 140, 114, { maxWidth: 54 });

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(18, 32, 58);
  doc.text("Foto de la unidad", 16, y);
  y += 4;
  const boxW = 92;
  const boxH = 58;
  doc.setDrawColor(190, 196, 204);
  doc.setFillColor(248, 249, 251);
  doc.roundedRect(16, y, boxW, boxH, 2, 2, "FD");
  if (photo) {
    try {
      doc.addImage(photo, imageFormat(photo), 17.5, y + 1.5, boxW - 3, boxH - 3);
    } catch {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(90, 98, 110);
      doc.text("No se pudo incrustar la foto.", 20, y + 30);
    }
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 98, 110);
    doc.text("Sin foto adjunta.", 20, y + 30);
  }

  if (visit.locked) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(18, 32, 58);
    doc.text(`Estado ${statusLabel(visit.status)}. El enlace ya no modifica este ingreso.`, 16, y + boxH + 10);
  }

  doc.save(`registro-${visit.publicCode || visit.tractorPlate || code}.pdf`);
}

const REPORT_HEADERS = ["Código", "Fecha", "Conductor", "Tracto", "Carreta", "Sede", "Motivo", "Empresa", "RUC", "Teléfono", "Brevete", "Código de equipo", "Observaciones", "Foto"];

function reportCells(row) {
  return [
    row.publicCode || "—",
    formatVisitWhen(row.visitAt || row.createdAt),
    row.driverName || "—",
    row.tractorPlate || "—",
    row.trailerPlate || "—",
    row.siteName || "—",
    motiveLabel(row.motive),
    row.company || "—",
    row.ruc || "—",
    visitFieldValue("phone", row),
    row.license || "—",
    row.equipmentCode || "—",
    row.observations || "—",
    row.hasPhoto ? "Sí" : "No",
  ];
}

function xmlEsc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function downloadStatusWorkbook(status, rows) {
  const head = REPORT_HEADERS.map((cell) => `<Cell><Data ss:Type="String">${xmlEsc(cell)}</Data></Cell>`).join("");
  const body = rows.map((row) => `<Row>${reportCells(row).map((cell) => `<Cell><Data ss:Type="String">${xmlEsc(cell)}</Data></Cell>`).join("")}</Row>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${xmlEsc(statusLabel(status).slice(0, 31))}"><Table><Row>${head}</Row>${body}</Table></Worksheet>
</Workbook>`;
  const url = URL.createObjectURL(new Blob([xml], { type: "application/vnd.ms-excel" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `conductores-${status || "estado"}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadStatusPdf(status, rows) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const title = `${statusLabel(status)} · ${rows.length} ingresos`;
  const columns = [
    ["Código", 22],
    ["Fecha", 32],
    ["Conductor", 38],
    ["Tracto", 24],
    ["Sede", 28],
    ["Motivo", 32],
    ["Empresa", 42],
    ["Teléfono", 28],
  ];
  const keys = [0, 1, 2, 3, 5, 6, 7, 9];
  const paintHead = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(18, 32, 58);
    doc.text(title, 10, 12);
    doc.setFontSize(8);
    let x = 10;
    const y = 18;
    doc.setFillColor(18, 32, 58);
    doc.rect(10, 14, 277, 7, "F");
    doc.setTextColor(255, 255, 255);
    columns.forEach(([label, width]) => {
      doc.text(label, x + 1, y);
      x += width;
    });
  };
  paintHead();
  let y = 25;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 36, 46);
  rows.forEach((row, index) => {
    if (y > 198) {
      doc.addPage();
      paintHead();
      y = 25;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 36, 46);
    }
    if (index % 2 === 0) {
      doc.setFillColor(245, 247, 250);
      doc.rect(10, y - 4, 277, 6, "F");
    }
    const cells = reportCells(row);
    let x = 10;
    keys.forEach((cell, column) => {
      const width = columns[column][1];
      const text = String(cells[cell] || "—").replace(/\s+/g, " ");
      doc.text(text.length > 22 ? `${text.slice(0, 21)}…` : text, x + 1, y);
      x += width;
    });
    y += 6;
  });
  doc.save(`conductores-${status || "estado"}.pdf`);
}

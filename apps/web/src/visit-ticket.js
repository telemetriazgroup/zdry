import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { publicUrl } from "./api.js";

export const VISIT_FIELDS = [
  ["tractorPlate", "Placa tracto"],
  ["company", "Empresa"],
  ["ruc", "RUC"],
  ["driverName", "Conductor"],
  ["visitAt", "Hora"],
  ["license", "Brevete"],
  ["motive", "Motivo"],
  ["trailerPlate", "Placa carreta"],
  ["phone", "Teléfono"],
  ["equipmentCode", "Código de equipo"],
];

export function motiveLabel(motive) {
  return motive === "cargar" ? "Cargar" : "Descargar";
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
  if (key === "visitAt") return formatVisitWhen(data.visitAt);
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
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function downloadVisitPdf(visit) {
  const token = visit.publicToken;
  const url = visitTicketHref(token);
  const code = shortVisitCode(token);
  const [logo, qr] = await Promise.all([
    asDataUrl(publicUrl("/brand/zg_marca.png")),
    QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: "M" }),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, 210, 38, "F");
  doc.addImage(logo, "PNG", 12, 7, 72, 24);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(18, 32, 58);
  doc.text("Comprobante de visita", 16, 52);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(70, 78, 90);
  const who = visit.driverName?.trim() || "conductor";
  doc.text(`Bienvenido, ${who}. Muestra este QR en portería.`, 16, 60);

  let y = 74;
  doc.setFontSize(11);
  for (const [key, label] of VISIT_FIELDS) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(18, 32, 58);
    doc.text(label, 16, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 48, 60);
    doc.text(String(visitFieldValue(key, visit)), 62, y, { maxWidth: 70 });
    y += 8;
  }

  doc.addImage(qr, "PNG", 140, 50, 52, 52);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Validación", 140, 108);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(code, 140, 115);
  doc.setFontSize(8);
  doc.setTextColor(90, 98, 110);
  doc.text(url, 140, 122, { maxWidth: 54 });

  doc.setTextColor(90, 98, 110);
  doc.setFontSize(9);
  doc.text("Si la visita aún no está asignada a un contenedor, el personal puede corregir los datos al escanear el QR.", 16, 170, { maxWidth: 178 });

  doc.save(`visita-${visit.tractorPlate || code}.pdf`);
}

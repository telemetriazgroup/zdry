import { jsPDF } from "jspdf";

function xmlEsc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function whenPe(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function auditExportRows(rows) {
  return (rows || []).map((r) => ({
    when: whenPe(r.createdAt),
    user: r.user?.email || "—",
    name: r.user?.name || "—",
    role: r.user?.role || "—",
    action: r.action || "—",
    entity: r.entity || "—",
    entityId: r.entityId || "—",
    ip: r.ip || "—",
  }));
}

function stampName(ext, from, to) {
  const a = from || "inicio";
  const b = to || "hoy";
  return `auditoria-zdry-${a}_${b}.${ext}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadAuditExcel(rows, from, to) {
  const list = auditExportRows(rows);
  const cells = (vals) => vals.map((v) => `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`).join("");
  const header = cells(["Cuándo", "Usuario", "Nombre", "Rol", "Acción", "Entidad", "Id", "IP"]);
  const body = list.map((r) => `<Row>${cells([r.when, r.user, r.name, r.role, r.action, r.entity, r.entityId, r.ip])}</Row>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Auditoria">
<Table>
<Row>${header}</Row>
${body}
</Table>
</Worksheet>
</Workbook>`;
  downloadBlob(new Blob([xml], { type: "application/vnd.ms-excel" }), stampName("xls", from, to));
}

export function downloadAuditPdf(rows, from, to) {
  const list = auditExportRows(rows);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const margin = 10;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cols = [
    { k: "when", w: 38, h: "Cuándo" },
    { k: "user", w: 48, h: "Usuario" },
    { k: "action", w: 32, h: "Acción" },
    { k: "entity", w: 36, h: "Entidad" },
    { k: "entityId", w: 52, h: "Id" },
    { k: "ip", w: 32, h: "IP" },
  ];
  const range = from || to ? `Rango: ${from || "…"} — ${to || "…"}` : "Rango: todo el historial";
  const now = new Date().toLocaleString("es-PE");

  function head(page) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("ZDRY — Reporte de auditoría", margin, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`${range}  ·  ${list.length} evento(s)  ·  ${now}  ·  p. ${page}`, margin, 18);
    let x = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    cols.forEach((c) => {
      doc.text(c.h, x, 26);
      x += c.w;
    });
    doc.setDrawColor(180);
    doc.line(margin, 28, pageW - margin, 28);
  }

  let page = 1;
  head(page);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  let y = 33;
  list.forEach((r) => {
    if (y > pageH - 10) {
      doc.addPage();
      page += 1;
      head(page);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      y = 33;
    }
    let x = margin;
    cols.forEach((c) => {
      const t = String(r[c.k] || "—");
      doc.text(t.length > 42 ? `${t.slice(0, 41)}…` : t, x, y);
      x += c.w;
    });
    y += 5;
  });
  if (!list.length) doc.text("Sin eventos en el rango.", margin, 36);
  doc.save(stampName("pdf", from, to));
}

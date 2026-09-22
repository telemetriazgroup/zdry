function xmlEsc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "";
  return String(Math.round(Number(n)));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS = {
  pendiente: "Pendiente de publicación",
  aprobado: "Visible en catálogo",
  oculto: "Oculta del catálogo",
  rechazado: "Oculta del catálogo",
};

export function downloadCatalogStockExcel(rows) {
  const list = rows || [];
  const cells = (vals) => vals.map((v) => `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`).join("");
  const header = cells([
    "ISO",
    "Tipo",
    "Condición",
    "Costo",
    "Extras",
    "Base",
    "Venta sugerida",
    "Rango min",
    "Rango max",
    "Precio a vender",
    "Fotos",
    "Catálogo",
    "Depósito",
    "Almacén Odoo",
    "Proveedor",
  ]);
  const body = list
    .map((r) =>
      `<Row>${cells([
        r.iso,
        r.type || "",
        r.cat || "",
        money(r.rawBase),
        money(r.overlayTotal),
        money(r.base),
        money(r.suggestedList),
        money(r.suggestedMin),
        money(r.suggestedList),
        money(r.priceList),
        String(r.photoCount ?? 0),
        STATUS[r.mediaStatus] || r.mediaStatus || "",
        r.depotName || "",
        r.odooWarehouse || "",
        r.odooVendorName || "",
      ])}</Row>`,
    )
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Stock catalogo">
<Table>
<Row>${header}</Row>
${body}
</Table>
</Worksheet>
</Workbook>`;
  const day = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([xml], { type: "application/vnd.ms-excel" }), `zdry-ficha-catalogo-${day}.xls`);
}

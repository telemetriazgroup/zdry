import { canPublicEditVisit, visitIsLocked, visitPhotoStatus } from "./gate-visit";
import {
  digitsFromExcel,
  equipmentIsoWarning,
  buildRegistryTemplate,
  excelDate,
  fillTemplate,
  formatLimaStamp,
  formatPublicCode,
  motiveForMessage,
  htmlSalidaUrl,
  normalizeStatus,
  registrationCard,
  registrationRequest,
  peruLocalPhone,
  peruReplyPhone,
  readXlsxSheets,
  registrationRows,
  validatePublicInput,
} from "./driver-registry";

describe("registro de conductores", () => {
  it("el enlace externo se cierra al salir de registrado", () => {
    expect(visitIsLocked("REGISTRADO")).toBe(false);
    expect(canPublicEditVisit("REGISTRADO")).toBe(true);
    expect(visitIsLocked("EN ATENCION")).toBe(true);
    expect(canPublicEditVisit("FINALIZADO")).toBe(false);
  });

  it("la foto se ve en cuanto existe y desaparece al archivarla", () => {
    expect(visitPhotoStatus({})).toBe("none");
    expect(visitPhotoStatus({ unitPhotoKey: "k" })).toBe("visible");
    expect(visitPhotoStatus({ unitPhotoKey: "k", unitPhotoArchivedAt: new Date() })).toBe("archived");
  });

  it("arma el código con la hora de Lima", () => {
    const when = excelDate("46279", "0.5973958333333333");
    expect(formatLimaStamp(when)).toBe("14/09/2026 14:20:15");
    expect(formatPublicCode(when)).toBe("ZG-20260914-142015");
  });

  it("avisa si el código no cumple la norma ISO y no lo cambia", () => {
    expect(equipmentIsoWarning("MSKU3366278")).toBe("");
    expect(equipmentIsoWarning("5054821")).toBe("No cumple la norma ISO");
    expect(equipmentIsoWarning("")).toBe("");
  });

  it("recupera dígitos que Excel guardó como número", () => {
    expect(digitsFromExcel("2.0611137819E10")).toBe("20611137819");
    expect(digitsFromExcel("1.00039207E8")).toBe("100039207");
    expect(digitsFromExcel("9.29405015E8")).toBe("929405015");
  });

  it("llena la plantilla de ubicación con un solo almacén", () => {
    const text = fillTemplate(
      "Hola, *{conductor}*.\n\nPuede dirigirse a nuestro almacén *{almacen}* para *{motivo}*.\n\n*Ubicación:* {mapa}",
      { conductor: "NEIL ANTHONY GAMERO PAREDES", almacen: "GAMBETA 1", motivo: "CARGAR CONTENEDOR", mapa: "https://maps.app.goo.gl/LaQNc1TTT3Svk6bYA" },
    );
    expect(text).toContain("*GAMBETA 1*");
    expect(text).toContain("https://maps.app.goo.gl/LaQNc1TTT3Svk6bYA");
    expect(text).not.toContain("GAMBETA 2");
  });

  it("Otros lleva el detalle en el mensaje", () => {
    expect(motiveForMessage("Otros", "recojo de un transformador")).toBe("OTROS - recojo de un transformador");
    expect(motiveForMessage("Cargar contenedor", "")).toBe("Cargar contenedor");
  });

  it("un ingreso nuevo exige RUC de 11 y teléfono de 9", () => {
    const bad = validatePublicInput({ siteId: "s", motiveId: "m", company: "LH", ruc: "100039207", driverName: "DOMINGO CHUCO", license: "21106707", phone: "954124973", tractorPlate: "CYB.476", trailerPlate: "A8F974" });
    expect(bad.ok).toBe(false);
    const ok = validatePublicInput({ siteId: "s", motiveId: "m", company: "LH TRADE", ruc: "20545385296", driverName: "DOMINGO CHUCO", license: "21106707", phone: "954124973", tractorPlate: "CYB.476", trailerPlate: "A8F974" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.tractorPlate).toBe("CYB.476");
  });

  it("conserva ANULADO al leer el estado histórico", () => {
    expect(normalizeStatus("ANULADO")).toBe("ANULADO");
    expect(normalizeStatus("en atención")).toBe("EN ATENCION");
  });

  it("lee una fila del registro y omite la que no tiene estado", () => {
    const parsed = registrationRows([
      {
        name: "REGISTROS",
        rows: [
          { A: "ZG-20260914-142015", B: "46279", C: "0.5973958333333333", D: "Transporte tyj", E: "2.0611137819E10", F: "César juan Ortega Escalante", G: "E44716974", H: "929405015", I: "F6Y 891", J: "BMH 982", K: "DESCARGAR", L: "", M: "FINALIZADO", N: "Devolución" },
          { A: "ZG-20260914-142016", B: "46279", C: "0", D: "ACME", E: "1", F: "Ana", G: "Q1", H: "999999999", I: "ABC123", J: "ABC124", K: "OTROS", L: "5054821.0", M: "", N: "" },
        ],
      },
      {
        name: "PIURA",
        rows: [
          { A: "ZG-20261110-082945", B: "46336", C: "0.35399305555555555", D: "NANO", E: "20614785544", F: "ELBER", G: "M1", H: "960120054", I: "X2W 843", J: "BWI 843", K: "CARGAR CONTENEDOR", L: "1186682.0", M: "FINALIZADO", N: "" },
        ],
      },
    ]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].siteName).toBe("Lima");
    expect(parsed.rows[0].ruc).toBe("20611137819");
    expect(parsed.rows[0].status).toBe("FINALIZADO");
    expect(parsed.rows[1].siteName).toBe("Piura");
    expect(parsed.rows[1].equipmentCode).toBe("1186682");
    expect(parsed.skipped[0].reason).toContain("estado");
  });

  it("la plantilla se lee y una fila sin id toma el código de la fecha", () => {
    const fromFile = registrationRows(readXlsxSheets(buildRegistryTemplate()));
    expect(fromFile.rows).toHaveLength(0);
    expect(fromFile.skipped[0].reason).toContain("ejemplo");
    const parsed = registrationRows([
      {
        name: "REGISTROS",
        rows: [
          { A: "", B: "10/11/2026", C: "09:56:08", D: "LH TRADE", E: "20545385296", F: "DOMINGO CHUCO", G: "21106707", H: "954124973", I: "CYB.476", J: "A8F974", K: "CARGAR CONTENEDOR", L: "", M: "", N: "" },
        ],
      },
    ]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].publicCode).toBe("ZG-20261110-095608");
    expect(parsed.rows[0].status).toBe("REGISTRADO");
    expect(parsed.rows[0].siteName).toBe("Lima");
  });

  it("el aviso de inscripción manda la ficha y no el texto ni el HTML", () => {
    const card = registrationCard({
      site: "Lima",
      motive: "Cargar contenedor",
      when: new Date("2026-11-10T14:56:08.000Z"),
      tractorPlate: "CYB.476",
      trailerPlate: "A8F974",
      driverName: "DOMINGO CHUCO CAPCHA",
      company: "LH TRADE",
      ruc: "20545385296",
      license: "21106707",
      phone: "954124973",
      equipmentCode: "",
      status: "REGISTRADO",
      observations: "",
      publicCode: "ZG-20261110-095608",
    });
    expect(card.fecha).toBe("10/11/2026");
    expect(card.hora).toBe("09:56:08");
    expect(card.codigoEquipo).toBe("NO INDICADO");
    const body = registrationRequest(card, [{ telefono: "51900000000", contacto: "51900000001" }], ["operaciones@zgroup.com.pe"]);
    expect(body.registro).toEqual(card);
    expect(body).not.toHaveProperty("html");
    expect(JSON.stringify(body.whatsapp)).not.toContain("mensaje");
    expect(htmlSalidaUrl("https://ztrack.app/servicio/salida")).toBe("https://ztrack.app/servicio/salida-registro");
    expect(htmlSalidaUrl("https://ztrack.app/servicio/salida-registro")).toBe("https://ztrack.app/servicio/salida-registro");
  });

  it("el teléfono de respuesta guarda el 51 y los 9 dígitos", () => {
    expect(peruLocalPhone("51927249461")).toBe("927249461");
    expect(peruLocalPhone("927249461")).toBe("927249461");
    expect(peruReplyPhone("927249461")).toBe("51927249461");
    expect(peruReplyPhone("51927249461")).toBe("51927249461");
    expect(peruReplyPhone("123")).toBeNull();
    expect(peruReplyPhone("")).toBe("");
  });
});

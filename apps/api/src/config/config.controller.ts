import { Controller, Get } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";

export const CONFIG_SECTIONS = [
  { id: "visibility", title: "Visibilidad de precios", blurb: "Reglas jerárquicas global → tipo → fabricante → unidad." },
  { id: "freight", title: "Tarifario de fletes", blurb: "Zonas, terrenos, márgenes min/rec/premium, vehículos." },
  { id: "rentals", title: "Reglas de alquiler", blurb: "Depreciación, márgenes, descuento por plazo y riesgo A–D." },
  { id: "providers", title: "Proveedores", blurb: "Lectura; el alta vive en Personas." },
  { id: "depot-services", title: "Servicios propios del depósito", blurb: "Gate in/out, reparación, lavado, movimiento interno." },
  { id: "commercial-services", title: "Servicios comerciales", blurb: "Precio fijo para cotización; nunca texto libre." },
  { id: "extra-concepts", title: "Conceptos de costos adicionales", blurb: "Catálogo que usa Compras." },
  { id: "yard-columns", title: "Reglas de columna de patio", blurb: "Min/max nivel, agrupar por condición o fabricante." },
  { id: "ops-discounts", title: "Descuentos operativos", blurb: "Días libres y movimientos libres." },
  { id: "fleet", title: "Flota de camiones", blurb: "Alta de unidades propias; sin doble asignación el mismo día." },
];

@Controller("config")
@Roles("admin", "gerente")
export class ConfigController {
  @Get("sections")
  sections() {
    return {
      sections: CONFIG_SECTIONS.map((s) => ({ ...s, status: "stub" as const })),
      note: "Sprint 1: anclas. La edición real entra en el Sprint 9 (flags de patio en S3).",
    };
  }
}

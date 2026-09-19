import { limaDayRange, notesFromMailRecords, stripOdooHtml } from "./odoo-lot-photos";

describe("limaDayRange", () => {
  it("usa el día indicado y cierra el rango en UTC-5", () => {
    const r = limaDayRange("2026-09-07");
    expect(r.date).toBe("2026-09-07");
    expect(r.start.toISOString()).toBe("2026-09-07T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-09-08T04:59:59.999Z");
  });
});

describe("notas chatter Odoo", () => {
  it("limpia HTML y descarta mensajes vacíos", () => {
    expect(stripOdooHtml("<p>Ajuste inicial<br>tara 3700</p>")).toBe("Ajuste inicial\ntara 3700");
    expect(notesFromMailRecords([
      { id: 1, body: "<p>Número de serie creado</p>", author_id: [8, "Marisol Zabarburu"], date: "2025-06-19 15:00:00" },
      { id: 2, body: "<p>  </p>", author_id: [8, "Admin"], date: "2025-06-19 15:01:00" },
    ])).toEqual([
      { id: 1, body: "Número de serie creado", author: "Marisol Zabarburu", date: "2025-06-19 15:00:00" },
    ]);
  });
});

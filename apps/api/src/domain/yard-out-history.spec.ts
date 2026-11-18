import { yardOutMoves } from "./yard-out-history";

describe("historial de un OUT", () => {
  it("marca al que salió y baja a los que estaban encima", () => {
    const before = [
      { iso: "A", lado: "Zona A", ruma: 2, columna: 3, nivel: 1, bayHalf: null },
      { iso: "B", lado: "Zona A", ruma: 2, columna: 3, nivel: 2, bayHalf: null },
      { iso: "C", lado: "Zona A", ruma: 2, columna: 3, nivel: 3, bayHalf: null },
      { iso: "D", lado: "Zona A", ruma: 2, columna: 3, nivel: 4, bayHalf: null },
    ];
    const after = [
      { iso: "A", lado: "Zona A", ruma: 2, columna: 3, nivel: 1, bayHalf: null },
      { iso: "C", lado: "Zona A", ruma: 2, columna: 3, nivel: 2, bayHalf: null },
      { iso: "D", lado: "Zona A", ruma: 2, columna: 3, nivel: 3, bayHalf: null },
    ];
    expect(yardOutMoves(before, after)).toEqual([
      { iso: "B", kind: "salida", from: { lado: "Zona A", ruma: 2, columna: 3, nivel: 2, half: "" }, to: null },
      { iso: "C", kind: "baja", from: { lado: "Zona A", ruma: 2, columna: 3, nivel: 3, half: "" }, to: { lado: "Zona A", ruma: 2, columna: 3, nivel: 2, half: "" } },
      { iso: "D", kind: "baja", from: { lado: "Zona A", ruma: 2, columna: 3, nivel: 4, half: "" }, to: { lado: "Zona A", ruma: 2, columna: 3, nivel: 3, half: "" } },
    ]);
  });

  it("un equipo que sigue en el mismo puesto no entra al historial", () => {
    const seats = [{ iso: "A", lado: "Zona A", ruma: 1, columna: 1, nivel: 1, bayHalf: "A" }];
    expect(yardOutMoves(seats, seats)).toEqual([]);
  });
});

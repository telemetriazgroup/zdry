export type YardSeatSnap = {
  iso: string;
  lado: string | null;
  ruma: number | null;
  columna: number | null;
  nivel: number | null;
  bayHalf?: string | null;
};

export type YardSpot = {
  lado: string;
  ruma: number | null;
  columna: number | null;
  nivel: number | null;
  half: string;
};

export type YardOutMove = {
  iso: string;
  kind: "salida" | "baja";
  from: YardSpot;
  to: YardSpot | null;
};

function spotOf(seat: YardSeatSnap): YardSpot {
  return {
    lado: seat.lado || "",
    ruma: seat.ruma,
    columna: seat.columna,
    nivel: seat.nivel,
    half: seat.bayHalf || "",
  };
}

function sameSpot(left: YardSpot, right: YardSpot) {
  return left.lado === right.lado && left.ruma === right.ruma && left.columna === right.columna && left.nivel === right.nivel && left.half === right.half;
}

/** Compara el patio de antes con el de ahora. El que ya no está salió. El que cambió de puesto bajó. */
export function yardOutMoves(before: YardSeatSnap[], after: YardSeatSnap[]): YardOutMove[] {
  const next = new Map(after.filter((seat) => seat.lado).map((seat) => [seat.iso, seat]));
  const moves: YardOutMove[] = [];
  for (const seat of before) {
    if (!seat.lado) continue;
    const stayed = next.get(seat.iso);
    const from = spotOf(seat);
    if (!stayed?.lado) {
      moves.push({ iso: seat.iso, kind: "salida", from, to: null });
      continue;
    }
    const to = spotOf(stayed);
    if (!sameSpot(from, to)) moves.push({ iso: seat.iso, kind: "baja", from, to });
  }
  return moves;
}

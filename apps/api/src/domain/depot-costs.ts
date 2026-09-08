export const SYSTEM_DEPOT_CONCEPTS = [
  { key: "gate_in", label: "Gate-In", amount: 30 },
  { key: "gate_out", label: "Gate-Out", amount: 30 },
  { key: "reparacion", label: "Reparación", amount: 120 },
  { key: "lavado", label: "Lavado", amount: 45 },
  { key: "movimiento", label: "Movimiento interno", amount: 25 },
] as const;

export const GATE_IN_KEY = "gate_in";

export function canApplyGateIn(existingKeys: string[]) {
  return !existingKeys.includes(GATE_IN_KEY);
}

export function presentDepotCost(
  row: { id: string; conceptKey: string; conceptLabel: string; amount: unknown; note: string; auto: boolean; createdByName: string; createdAt: Date },
  hideAmount: boolean,
) {
  return {
    id: row.id,
    conceptKey: row.conceptKey,
    conceptLabel: row.conceptLabel,
    note: row.note,
    auto: row.auto,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    amount: hideAmount ? null : Number(row.amount),
  };
}

export function handoffMessage(input: {
  contactName: string;
  typeLabel: string;
  iso: string;
  catLabel: string;
  year: number | null;
  depotName: string;
  manufacturer: string;
  includePrice: boolean;
  priceList: number | null;
  url: string;
}): string {
  const who = input.contactName.trim() || "cliente";
  const lines = [
    `Hola ${who}, te comparto un equipo que puede interesarte:`,
    `${input.typeLabel} · ${input.iso}`,
    [input.catLabel, input.year ? String(input.year) : "", input.depotName].filter(Boolean).join(" · "),
  ];
  if (input.manufacturer && input.manufacturer !== "—") lines.push(`Fabricante: ${input.manufacturer}`);
  if (input.includePrice && input.priceList && input.priceList > 0) {
    lines.push(`Precio de lista: USD ${Math.round(input.priceList)}.`);
  }
  lines.push(`Fotos y video: ${input.url}`);
  return lines.join("\n");
}

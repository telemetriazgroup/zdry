/** El precio pedido tiene que quedar debajo del mínimo. Dentro del rango no es excepción. */
export function exceptionPriceError(price: number, priceMin: number): string | null {
  if (!Number.isFinite(price) || price <= 0) return "Indica un precio mayor que cero.";
  if (!Number.isFinite(priceMin) || priceMin <= 0) return "Esta unidad no tiene mínimo. Se ofrece al precio de lista.";
  if (price >= priceMin) return "Ese precio está dentro del rango permitido. No hace falta una aprobación.";
  return null;
}

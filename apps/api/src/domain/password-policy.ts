/** Clave que deja Personas al restablecer. Al entrar, hay que cambiarla. */
export const TEMP_PASSWORD = "123456789";

export function isTemporaryPassword(value: string) {
  return value === TEMP_PASSWORD;
}

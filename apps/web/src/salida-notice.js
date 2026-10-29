const LABEL = {
  en_cola: "en cola",
  en_espera: "en espera, se reintenta cuando salga el anterior",
  rechazado: "rechazado",
  omitido: "no se envió",
  error: "falló",
};

export function whatsappQueued(salida) {
  return Boolean(salida)
    && (salida.channel === "whatsapp" || salida.channel === "ambos")
    && (salida.whatsapp === "en_cola" || salida.whatsapp === "en_espera");
}

export function salidaNotice(salida) {
  if (!salida || salida.channel === "ninguno") return "";
  const parts = [];
  if (salida.channel === "whatsapp" || salida.channel === "ambos") {
    const label = whatsappQueued(salida) ? "en envío" : LABEL[salida.whatsapp];
    if (label) parts.push(`WhatsApp ${label}`);
  }
  if (salida.channel === "correo" || salida.channel === "ambos") {
    const label = LABEL[salida.correo];
    if (label) parts.push(`Correo ${label}`);
  }
  return [parts.join(". "), salida.motivo].filter(Boolean).join(". ");
}

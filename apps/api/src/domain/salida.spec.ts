import { buildSalidaTest, buildShareNotice, normalizeSalidaConfig, presentSalidaConfig, readSalidaStates, shareAvisoText, shareNoticePack, unitInterestNotice, vendorFollowNotice, vendorReturnNotice } from "./salida";

describe("salida SGIT", () => {
  it("por defecto no envía y la clave nueva reemplaza la guardada", () => {
    const saved = normalizeSalidaConfig({ url: "https://ztrack.app/servicio/salida", clave: "secreta", channel: "ambos" });
    expect(presentSalidaConfig(saved)).toEqual({
      url: "https://ztrack.app/servicio/salida",
      channel: "ambos",
      claveSet: true,
    });
    expect(normalizeSalidaConfig({ channel: "ninguno", clave: "" }, saved)).toMatchObject({
      clave: "secreta",
      channel: "ninguno",
    });
    expect(() => normalizeSalidaConfig({ url: "http://ztrack.app/servicio/salida" })).toThrow(/https/);
  });

  it("saluda al cliente conocido, da la bienvenida al nuevo y nombra al comercial", () => {
    const known = shareNoticePack({
      known: true,
      name: "Ana",
      company: "Andina SAC",
      ruc: "20100070970",
      dni: "",
      address: "Lima",
      email: "ana@demo.pe",
      phone: "51999111222",
      vendorName: "Valeria",
      vendorPhone: "51911111111",
      url: "https://local/zdry/c/abc",
      code: "123456",
      hours: 3,
    });
    expect(known.subject).toMatch(/saluda/);
    expect(known.email).toMatch(/Zgroup te saluda nuevamente/);
    expect(known.email).toMatch(/Andina SAC/);
    expect(known.email).toMatch(/Valeria/);
    expect(known.email).toMatch(/\+51 911 111 111/);
    expect(known.whatsapp).toMatch(/Clave de acceso: \*123456\*/);
    expect(known.whatsapp).not.toMatch(/Tus datos/);
    expect(known.whatsapp).not.toMatch(/Empresa:/);
    expect(known.html).toMatch(/Ver catálogo/);
    expect(known.html).toMatch(/#12203a/);
    expect(known.html).toMatch(/#d9622f/);
    expect(known.html).toMatch(/TUS DATOS/);
    const fresh = shareNoticePack({
      known: false,
      name: "Ana",
      company: "Ana",
      ruc: "",
      dni: "12345678",
      address: "",
      email: "ana@demo.pe",
      phone: "51999111222",
      vendorName: "Valeria",
      vendorPhone: "51911111111",
      url: "https://local/zdry/c/abc",
      code: "123456",
      hours: 1,
    });
    expect(fresh.email).toMatch(/te da la bienvenida/);
    expect(fresh.email).not.toMatch(/Empresa:/);
    expect(known.email).toMatch(/3 horas/);
    expect(known.email).not.toMatch(/había vencido/);
    const reopened = shareNoticePack({
      known: true,
      name: "Ana",
      company: "Andina SAC",
      ruc: "20100070970",
      dni: "",
      address: "Lima",
      email: "ana@demo.pe",
      phone: "51999111222",
      vendorName: "Valeria",
      vendorPhone: "51911111111",
      url: "https://local/zdry/c/abc",
      code: "123456",
      hours: 3,
      minutes: 30,
    });
    expect(reopened.subject).toMatch(/sigue abierto/);
    expect(reopened.email).toMatch(/30 minutos/);
    expect(reopened.email).toMatch(/había vencido/);
    expect(reopened.whatsapp).toMatch(/30 minutos/);
    const alert = vendorReturnNotice({
      vendorName: "Valeria",
      clientName: "Ana",
      company: "Andina SAC",
      ruc: "20100070970",
      dni: "",
    });
    expect(alert.message).toMatch(/buscando información/);
    expect(alert.message).toMatch(/30 minutos/);
    expect(alert.message).not.toMatch(/Clave/);
    expect(alert.message).not.toMatch(/123456/);
    const opened = vendorFollowNotice({
      vendorName: "Valeria",
      clientName: "Ana",
      company: "Andina SAC",
      ruc: "20100070970",
      dni: "",
      phone: "51999111222",
      email: "ana@demo.pe",
      byClient: false,
    });
    expect(opened.subject).toMatch(/seguimiento/);
    expect(opened.message).toMatch(/Andina SAC/);
    expect(opened.message).toMatch(/\*Cliente\*/);
    expect(opened.html).toMatch(/#12203a/);
    expect(opened.html).toMatch(/#d9622f/);
    expect(opened.html).not.toMatch(/Clave/);
    expect(opened.message).not.toMatch(/Clave/);
    const asked = unitInterestNotice({
      vendorName: "Valeria",
      clientName: "Ana",
      company: "Andina SAC",
      iso: "CIMU2022411",
      type: "40HC",
      phone: "51999111222",
      email: "ana@demo.pe",
    });
    expect(asked.message).toMatch(/CIMU2022411/);
    expect(asked.message).toMatch(/cotización fue solicitada/);
    expect(asked.message).not.toMatch(/Clave/);
    const both = buildShareNotice({
      channel: "ambos",
      phone: "51999111222",
      email: "ana@demo.pe",
      message: known.whatsapp,
      emailBody: known.email,
      html: known.html,
      contact: "51911111111",
      subject: known.subject,
    });
    expect(both.body).toMatchObject({
      whatsapp: { telefono: "51999111222", contacto: "51911111111" },
      correo: { direccion: "ana@demo.pe", asunto: known.subject },
    });
    expect(String((both.body?.correo as { html: string }).html)).toMatch(/ZGROUP/);
    const missing = buildShareNotice({
      channel: "whatsapp",
      phone: "51999111222",
      email: "",
      message: known.whatsapp,
      contact: "123",
      subject: "Tu catálogo ZDRY",
    });
    expect(missing.body).toBeNull();
    expect(missing.plan.whatsapp).toBe("omitido");
    expect(missing.plan.motivo).toMatch(/comercial/);
    expect(buildShareNotice({ channel: "ninguno", phone: "", email: "", message: "", contact: "", subject: "" }).body).toBeNull();
  });

  it("arma la prueba solo con el canal elegido y no manda datos a medias", () => {
    const both = buildSalidaTest({
      whatsapp: true,
      correo: true,
      telefono: "987654321",
      contacto: "51911111111",
      email: "prueba@demo.pe",
      mensaje: "",
    });
    expect(both.body).toMatchObject({
      whatsapp: { telefono: "987654321", contacto: "51911111111" },
      correo: { direccion: "prueba@demo.pe", asunto: "Prueba de salida ZDRY" },
    });
    expect(String((both.body?.correo as { cuerpo: string }).cuerpo)).toMatch(/Mensaje de prueba/);
    const broken = buildSalidaTest({
      whatsapp: true,
      correo: false,
      telefono: "12",
      contacto: "51911111111",
      email: "",
      mensaje: "Hola",
    });
    expect(broken.body).toBeNull();
    expect(broken.plan.motivo).toMatch(/destino/);
  });

  it("resume el aviso al cliente y al comercial", () => {
    const queued = { channel: "ambos" as const, whatsapp: "en_cola" as const, correo: "en_cola" as const, motivo: "" };
    expect(shareAvisoText(queued, queued).text).toMatch(/WhatsApp y los correos/);
    expect(shareAvisoText(queued, { ...queued, whatsapp: "en_espera" }).ok).toBe(false);
    expect(shareAvisoText(
      { channel: "ninguno", whatsapp: "apagado", correo: "apagado", motivo: "" },
      { channel: "ninguno", whatsapp: "apagado", correo: "apagado", motivo: "" },
    ).text).toMatch(/apagado/);
  });

  it("lee en_cola y en_espera sin repetir el texto", () => {
    const plan = { channel: "ambos" as const, whatsapp: "en_cola" as const, correo: "en_cola" as const, motivo: "" };
    expect(readSalidaStates({
      whatsapp: [{ estado: "en_espera", motivo: "Ese número todavía tiene un mensaje sin salir." }],
      correos: [{ estado: "en_cola" }],
    }, plan)).toMatchObject({ whatsapp: "en_espera", correo: "en_cola" });
  });
});

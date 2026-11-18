import { contactClock, EXECUTIVE_PING_MS, interestNoticeText, messageWebOrigin, offerPrice, parseClientChoice, parseThreadId, priceLines, staffThreadsUrl, threadReference, VENDOR_PING_MS } from "./commercial-thread";

describe("hilo comercial", () => {
  it("acepta el precio de lista y rechaza uno fuera del rango", () => {
    expect(offerPrice({ useList: true, amount: null, priceMin: 800, priceList: 1000 })).toEqual({ ok: true, net: 1000 });
    expect(offerPrice({ useList: false, amount: 900, priceMin: 800, priceList: 1000 })).toEqual({ ok: true, net: 900 });
    expect(offerPrice({ useList: false, amount: 700, priceMin: 800, priceList: 1000 }).ok).toBe(false);
    expect(offerPrice({ useList: false, amount: 1100, priceMin: 800, priceList: 1000 }).ok).toBe(false);
  });

  it("muestra el neto, el IGV y el total", () => {
    expect(priceLines(1000)).toMatchObject({ net: 1000, igv: 180, gross: 1180 });
  });

  it("lee 1, 2, 3 y OK", () => {
    expect(parseClientChoice("1")).toBe("1");
    expect(parseClientChoice("ok")).toBe("ok");
    expect(parseClientChoice("OK")).toBe("ok");
    expect(parseClientChoice("hola")).toBe("libre");
  });

  it("recupera el hilo desde la referencia", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(parseThreadId(threadReference(id, 1))).toBe(id);
    expect(parseThreadId("otro")).toBe("");
  });

  it("insiste a los 5 minutos y avisa al ejecutivo a los 15", () => {
    const asked = new Date("2026-11-18T12:00:00.000Z");
    const quiet = contactClock({
      contactAskedAt: asked,
      vendorOkAt: null,
      lastVendorPingAt: asked,
      executivePingAt: null,
      now: new Date(asked.getTime() + VENDOR_PING_MS - 1),
    });
    expect(quiet).toEqual({ pingVendor: false, pingExecutive: false });
    const remind = contactClock({
      contactAskedAt: asked,
      vendorOkAt: null,
      lastVendorPingAt: asked,
      executivePingAt: null,
      now: new Date(asked.getTime() + VENDOR_PING_MS),
    });
    expect(remind.pingVendor).toBe(true);
    expect(remind.pingExecutive).toBe(false);
    const escalate = contactClock({
      contactAskedAt: asked,
      vendorOkAt: null,
      lastVendorPingAt: new Date(asked.getTime() + 10 * 60 * 1000),
      executivePingAt: null,
      now: new Date(asked.getTime() + EXECUTIVE_PING_MS),
    });
    expect(escalate.pingExecutive).toBe(true);
    const done = contactClock({
      contactAskedAt: asked,
      vendorOkAt: new Date(asked.getTime() + 60_000),
      lastVendorPingAt: asked,
      executivePingAt: null,
      now: new Date(asked.getTime() + EXECUTIVE_PING_MS),
    });
    expect(done).toEqual({ pingVendor: false, pingExecutive: false });
  });

  it("arma el enlace del hilo con ztrack.app cuando la salida ya es de producción", () => {
    expect(messageWebOrigin("http://localhost:28080", "https://ztrack.app/servicio/salida")).toBe("https://ztrack.app");
    expect(messageWebOrigin("https://ztrack.app", "https://ztrack.app/servicio/salida")).toBe("https://ztrack.app");
    expect(messageWebOrigin("http://localhost:28080", "")).toBe("http://localhost:28080");
    const link = staffThreadsUrl(messageWebOrigin("http://localhost:28080", "https://ztrack.app/servicio/salida"));
    expect(link).toBe("https://ztrack.app/zdry/app/hilos");
    expect(interestNoticeText({
      who: "Valeria",
      clientName: "Luis",
      iso: "CAIU8431710",
      unitType: "40HC",
      priceList: 1711,
      priceMin: 1656,
      threadsUrl: link,
    })).toContain("https://ztrack.app/zdry/app/hilos");
  });
});

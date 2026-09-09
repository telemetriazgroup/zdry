import { Request } from "express";
import { clientOrigin } from "./client-origin";

describe("client origin", () => {
  it("toma la primera IP de X-Forwarded-For", () => {
    const req = {
      headers: {
        "x-forwarded-for": "181.65.10.2, 10.0.0.1",
        "user-agent": "Mozilla/5.0",
        "accept-language": "es-PE",
        host: "ztrack.app",
      },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;
    const meta = clientOrigin(req);
    expect(meta.ip).toBe("181.65.10.2");
    expect(meta.userAgent).toContain("Mozilla");
    expect(meta.originHost).toBe("ztrack.app");
  });
});

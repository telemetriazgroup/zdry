import { canPublicEditVisit, normalizePlate, shortVisitCode, visitIsLocked, visitPhotoStatus } from "./gate-visit";

describe("gate visit plate", () => {
  it("normaliza placa de tracto", () => {
    expect(normalizePlate("abc-123")).toBe("ABC123");
    expect(normalizePlate(" A1B-234 ")).toBe("A1B234");
  });

  it("el enlace público sigue abierto mientras el ingreso está registrado", () => {
    expect(visitIsLocked("REGISTRADO")).toBe(false);
    expect(canPublicEditVisit("REGISTRADO")).toBe(true);
    expect(visitIsLocked("FINALIZADO")).toBe(true);
    expect(canPublicEditVisit("CANCELADO")).toBe(false);
  });

  it("el código corto de validación sale del token público", () => {
    expect(shortVisitCode("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe("A1B2C3D4");
  });

  it("la foto de unidad se ve sin aprobación y se oculta al archivarla", () => {
    expect(visitPhotoStatus({})).toBe("none");
    expect(visitPhotoStatus({ unitPhotoKey: "k" })).toBe("visible");
    expect(visitPhotoStatus({ unitPhotoKey: "k", unitPhotoArchivedAt: new Date() })).toBe("archived");
    expect(visitPhotoStatus({ unitPhotoKey: "k", unitPhotoRejectedAt: new Date() })).toBe("rejected");
  });
});

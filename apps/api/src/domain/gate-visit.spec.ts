import { canPublicEditVisit, normalizePlate, visitIsLocked, visitPhotoStatus } from "./gate-visit";

describe("gate visit plate", () => {
  it("normaliza placa de tracto", () => {
    expect(normalizePlate("abc-123")).toBe("ABC123");
    expect(normalizePlate(" A1B-234 ")).toBe("A1B234");
  });

  it("queda cerrada al vincular a un ISO", () => {
    expect(visitIsLocked(null)).toBe(false);
    expect(canPublicEditVisit(null)).toBe(true);
    expect(visitIsLocked(new Date())).toBe(true);
    expect(canPublicEditVisit(new Date())).toBe(false);
  });

  it("la foto de unidad queda pendiente hasta que el coordinador aprueba", () => {
    expect(visitPhotoStatus({})).toBe("none");
    expect(visitPhotoStatus({ unitPhotoKey: "k" })).toBe("pending");
    expect(visitPhotoStatus({ unitPhotoKey: "k", unitPhotoApprovedAt: new Date() })).toBe("approved");
    expect(visitPhotoStatus({ unitPhotoKey: "k", unitPhotoRejectedAt: new Date() })).toBe("rejected");
  });
});

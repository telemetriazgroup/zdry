import { roleIsAllowed } from "./auth.types";

describe("roleIsAllowed", () => {
  it("superadmin entra a cualquier lista de roles", () => {
    expect(roleIsAllowed("superadmin", ["admin"])).toBe(true);
    expect(roleIsAllowed("superadmin", ["cliente"])).toBe(true);
    expect(roleIsAllowed("superadmin", ["superadmin"])).toBe(true);
  });

  it("el resto solo si está en la lista", () => {
    expect(roleIsAllowed("admin", ["admin", "gerente"])).toBe(true);
    expect(roleIsAllowed("admin", ["superadmin"])).toBe(false);
    expect(roleIsAllowed("vendedor", ["admin"])).toBe(false);
  });

  it("sin roles exigidos cualquiera autenticado pasa si hay rol", () => {
    expect(roleIsAllowed("admin", [])).toBe(true);
    expect(roleIsAllowed(undefined, ["admin"])).toBe(false);
  });
});

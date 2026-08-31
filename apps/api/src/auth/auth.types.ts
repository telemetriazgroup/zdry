import { Role } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export const COST_ROLES: Role[] = ["admin", "compras"];
export const MARGIN_ROLES: Role[] = ["admin", "compras", "gerente"];
export const CONFIG_ROLES: Role[] = ["admin", "gerente"];
export const COMMERCIAL_ROLES: Role[] = ["admin", "gerente", "vendedor"];

export function canSeeRealCosts(role: Role): boolean {
  return COST_ROLES.includes(role);
}

export function canSeeMargin(role: Role): boolean {
  return MARGIN_ROLES.includes(role);
}

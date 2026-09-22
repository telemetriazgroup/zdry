import { Role } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  customerId?: string | null;
  hasAvatar?: boolean;
  whatsapp?: string;
  impersonator?: { id: string; email: string; name: string; role: Role } | null;
};

export const COST_ROLES: Role[] = ["superadmin", "admin", "compras"];
export const MARGIN_ROLES: Role[] = ["superadmin", "admin", "compras", "gerente"];
export const CONFIG_ROLES: Role[] = ["superadmin", "admin", "gerente"];
export const COMMERCIAL_ROLES: Role[] = ["superadmin", "admin", "gerente", "vendedor"];

export function isSuperadmin(role?: Role | null): boolean {
  return role === "superadmin";
}

/** Superadmin entra en cualquier @Roles. El resto debe estar en la lista. */
export function roleIsAllowed(userRole: Role | undefined, roles?: Role[] | null): boolean {
  if (!roles || roles.length === 0) return true;
  if (!userRole) return false;
  if (userRole === "superadmin") return true;
  return roles.includes(userRole);
}

export function canSeeRealCosts(role: Role): boolean {
  return COST_ROLES.includes(role);
}

export function canSeeMargin(role: Role): boolean {
  return MARGIN_ROLES.includes(role);
}

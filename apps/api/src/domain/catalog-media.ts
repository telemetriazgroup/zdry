/** Publicación de ficha multimedia al catálogo. */

export const MEDIA_STATUSES = ["pendiente", "aprobado", "rechazado"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_EDITOR_ROLES = ["admin", "almacen", "compras", "gerente"] as const;
export const MEDIA_APPROVER_ROLES = ["admin", "gerente"] as const;

export function isMediaApproved(status?: string | null): boolean {
  return status === "aprobado";
}

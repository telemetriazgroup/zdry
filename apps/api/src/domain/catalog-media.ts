/** Publicación de ficha multimedia al catálogo. Independiente del rechazo por foto. */

export const MEDIA_STATUSES = ["pendiente", "aprobado", "oculto"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_EDITOR_ROLES = ["admin", "almacen", "compras", "gerente"] as const;
export const MEDIA_APPROVER_ROLES = ["admin", "gerente"] as const;

export const PHOTO_STATUS_ACTIVE = "activa";
export const PHOTO_STATUS_REJECTED = "rechazada";

export const activePhotosInclude = { where: { status: PHOTO_STATUS_ACTIVE } as const };
export const activePhotoWhere = { status: PHOTO_STATUS_ACTIVE };

export function isMediaApproved(status?: string | null): boolean {
  return status === "aprobado";
}

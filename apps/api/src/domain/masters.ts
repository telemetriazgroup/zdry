export const ACTIVE_MASTER = { archivedAt: null } as const;

export function masterListWhere(includeArchived?: string | boolean) {
  const include = includeArchived === true || includeArchived === "1" || includeArchived === "true";
  return include ? {} : ACTIVE_MASTER;
}

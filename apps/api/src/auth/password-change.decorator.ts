import { SetMetadata } from "@nestjs/common";

export const ALLOW_PASSWORD_CHANGE_KEY = "allowPasswordChange";

/** Rutas que siguen abiertas mientras la clave temporal no se haya cambiado. */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

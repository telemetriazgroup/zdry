import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { Role } from "@prisma/client";

/** Comercial, despacho y administrador. Compras y gerencia siguen con la cuenta principal. */
export const ODOO_GATE_ROLES: Role[] = ["admin", "vendedor", "coordinador"];

export const ODOO_CUTOVER_KEY = "odoo_cutover";

export function odooGateRequired(role?: Role | null): boolean {
  return !!role && ODOO_GATE_ROLES.includes(role);
}

export function odooLoginMatches(zdryEmail: string, odooLogin: string): boolean {
  return zdryEmail.trim().toLowerCase() === String(odooLogin || "").trim().toLowerCase();
}

/** Lectura mínima según el rol. No escribe nada en Odoo. */
export function odooProbeModel(role?: Role | null): "sale.order" | "stock.lot" {
  return role === "vendedor" ? "sale.order" : "stock.lot";
}

export function redactOdooSecret(message: string, secret?: string | null): string {
  let out = String(message || "");
  const key = String(secret || "");
  if (key.length > 3) out = out.split(key).join("••••");
  return out.slice(0, 400);
}

export function sameOdooOrigin(a: { url?: string; db?: string }, b: { url?: string; db?: string }): boolean {
  const norm = (url?: string) => String(url || "").trim().replace(/\/$/, "").toLowerCase();
  return norm(a.url) === norm(b.url) && String(a.db || "").trim() === String(b.db || "").trim();
}

function secretKey(): Buffer {
  const raw = process.env.ODOO_LINK_SECRET || process.env.JWT_SECRET || "cambiar-en-produccion";
  return createHash("sha256").update(`zdry-odoo-link:${raw}`).digest();
}

export function encryptOdooKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptOdooKey(payload: string): string {
  const [ivB, tagB, encB] = String(payload || "").split(".");
  if (!ivB || !tagB || !encB) throw new Error("Clave guardada ilegible.");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]);
  return plain.toString("utf8");
}

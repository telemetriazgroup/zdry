/** Prefijo público: todo vive bajo /zdry/ (ip:28080/zdry/…). */
export const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
/** Raíz con barra final. Sin ella el navegador pierde /zdry/ y los assets. */
export const APP_ROOT = `${BASE_PATH || ""}/`;

export function rewriteAppRootUrl(url) {
  if (url == null || typeof window === "undefined") return url;
  try {
    const u = new URL(String(url), window.location.origin);
    if (u.pathname === BASE_PATH) return `${APP_ROOT}${u.search}${u.hash}`;
  } catch {
    /* ignore */
  }
  return url;
}

export function ensureAppSlash() {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  if (pathname === BASE_PATH) {
    window.history.replaceState(window.history.state, "", `${APP_ROOT}${search}${hash}`);
  }
}

let historyPatched = false;
export function installHistorySlashFix() {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  window.history.pushState = (data, unused, url) => {
    push(data, unused, url === undefined ? url : rewriteAppRootUrl(url));
  };
  window.history.replaceState = (data, unused, url) => {
    replace(data, unused, url === undefined ? url : rewriteAppRootUrl(url));
  };
  ensureAppSlash();
}

export function goAppRoot() {
  window.location.assign(APP_ROOT);
}

/** Cierra ficha / vuelve al catálogo sin dejar la URL en /zdry (sin barra). */
export function goCatalogHome(navigate) {
  if (typeof navigate === "function") navigate("/", { replace: true });
  ensureAppSlash();
}

export function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}/api${p}`;
}

export function formatWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function publicUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${p}`;
}

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || data?.error || `HTTP ${status}`);
    this.status = status;
    this.data = data;
  }
}

async function parse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

export async function api(path, { method = "GET", body, retry = true } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && path !== "/auth/login" && path !== "/auth/refresh") {
    const refreshed = await fetch(apiUrl("/auth/refresh"), { method: "POST", credentials: "include" });
    if (refreshed.ok) return api(path, { method, body, retry: false });
  }

  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function apiUpload(path, formData, { retry = true } = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (res.status === 401 && retry) {
    const refreshed = await fetch(apiUrl("/auth/refresh"), { method: "POST", credentials: "include" });
    if (refreshed.ok) return apiUpload(path, formData, { retry: false });
  }

  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function apiBlob(path) {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (res.status === 401) {
    const refreshed = await fetch(apiUrl("/auth/refresh"), { method: "POST", credentials: "include" });
    if (refreshed.ok) return apiBlob(path);
  }
  if (!res.ok) {
    const data = await parse(res);
    throw new ApiError(res.status, data);
  }
  return res.blob();
}

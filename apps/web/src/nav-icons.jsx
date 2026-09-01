const PATHS = {
  home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  boxes: "M21 8V6l-9-4-9 4v2l9 4 9-4zm0 4-9 4-9-4m18 4-9 4-9-4",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm11 14v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 19.5z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L13 3h-4l-.2 2.5a7 7 0 0 0-1.7 1L4.7 5.9l-2 3.5 2 1.5a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1L9 21h4l.2-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z",
  clipboard: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2",
  cart: "M6 6h15l-1.5 9h-11zM6 6 5 3H2m4 15a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm11 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  inbox: "M22 12h-6l-2 3H10l-2-3H2m0 0v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6M2 12l3.3-7A2 2 0 0 1 7.1 4h9.8a2 2 0 0 1 1.8 1L22 12",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  card: "M2 7h20v12H2zM2 11h20M2 7V5h20v2",
  truck: "M3 7h11v10H3zM14 10h5l3 3v4h-8M7 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm11 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  calendar: "M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  tag: "M20.6 13.4 12 22l-9-9 8.6-8.6a2 2 0 0 1 1.4-.4H19a2 2 0 0 1 2 2v6a2 2 0 0 1-.4 1.4zM7 7h.01",
  receipt: "M6 3h12v18l-2-1-2 1-2-1-2 1-2-1-2 1zM9 8h6M9 12h6M9 16h4",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6",
  plus: "M12 5v14M5 12h14",
};

export function NavIcon({ name }) {
  const d = PATHS[name] || PATHS.home;
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function iconFor(path) {
  if (path === "/app") return "home";
  if (path.includes("inventario")) return "boxes";
  if (path.includes("personas")) return "users";
  if (path.includes("maestros")) return "book";
  if (path.includes("configuracion") || path.includes("precios")) return "gear";
  if (path.includes("auditoria")) return "clipboard";
  if (path.includes("compras/extras")) return "plus";
  if (path.includes("compras/dam")) return "file";
  if (path.includes("compras")) return "receipt";
  if (path.includes("recepcion")) return "inbox";
  if (path.includes("patio")) return "grid";
  if (path.includes("catalogo-textos")) return "tag";
  if (path.includes("catalogo-media")) return "camera";
  if (path.includes("perfil")) return "user";
  if (path.includes("bandeja")) return "inbox";
  if (path.includes("negociacion")) return "chat";
  if (path.includes("pagos")) return "card";
  if (path.includes("seguimiento") || path.includes("despachos")) return "truck";
  if (path.includes("alquileres")) return "calendar";
  if (path.includes("equipo")) return "users";
  return "home";
}

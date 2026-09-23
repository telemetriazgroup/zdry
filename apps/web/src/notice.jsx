import { useEffect, useState } from "react";

export function useNotice() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast((cur) => (cur && cur.id === toast.id ? null : cur)), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  function notify(text, kind = "ok") {
    if (!text) return;
    setToast({ text: String(text), kind, id: Date.now() });
  }

  const toastNode = toast ? (
    <div className={`app-toast ${toast.kind === "err" ? "err" : "ok"}`} role="status">
      <span>{toast.text}</span>
      <button type="button" className="app-toast-x" onClick={() => setToast(null)} aria-label="Cerrar aviso">×</button>
    </div>
  ) : null;

  return { notify, toastNode };
}

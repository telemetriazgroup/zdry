import { useState } from "react";

export function NoticeModal({ title, text, confirmLabel, onClose, onConfirm }) {
  if (!text) return null;
  return (
    <div className="overlay open notice-overlay" role="presentation">
      <div className="modal reg-alert" role="dialog" aria-modal="true" aria-labelledby="notice-title">
        <div className="modal-head">
          <h3 id="notice-title">{title || "Aviso"}</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body single">
          <p>{text}</p>
          <div className="action-row">
            {onConfirm ? <button className="btn-ghost" type="button" onClick={onClose}>Cancelar</button> : null}
            <button className="btn-primary" type="button" onClick={onConfirm || onClose}>{confirmLabel || "Entendido"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useNotice() {
  const [toast, setToast] = useState(null);

  function notify(text, kind = "ok") {
    if (!text) return;
    setToast({ text: String(text), kind, id: Date.now() });
  }

  const toastNode = (
    <NoticeModal
      title={toast?.kind === "err" ? "Aviso" : "Listo"}
      text={toast?.text || ""}
      onClose={() => setToast(null)}
    />
  );

  return { notify, toastNode };
}

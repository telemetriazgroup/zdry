import { useEffect, useRef, useState } from "react";
import { apiUrl } from "./api.js";
import VideoMarks, { videoSilenceProps } from "./video-marks.jsx";

export function useLightbox() {
  const [lb, setLb] = useState(null);
  return {
    open(items, index = 0) {
      const list = (items || []).filter((x) => x?.src);
      if (!list.length) return;
      setLb({ items: list, index: Math.max(0, Math.min(index, list.length - 1)) });
    },
    close() {
      setLb(null);
    },
    node: lb ? <MediaLightbox items={lb.items} index={lb.index} onClose={() => setLb(null)} /> : null,
  };
}

export default function MediaLightbox({ items, index = 0, onClose }) {
  const [i, setI] = useState(index);
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const wrap = useRef(null);
  const item = items[i] || items[0];
  const many = items.length > 1;

  useEffect(() => {
    setI(index);
    setZoom(1);
  }, [index, items]);

  useEffect(() => {
    const alreadyLocked = document.body.classList.contains("modal-locked");
    if (!alreadyLocked) document.body.classList.add("modal-locked");
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && many) {
        setI((x) => (x + 1) % items.length);
        setZoom(1);
      }
      if (e.key === "ArrowLeft" && many) {
        setI((x) => (x - 1 + items.length) % items.length);
        setZoom(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      if (!alreadyLocked) document.body.classList.remove("modal-locked");
      window.removeEventListener("keydown", onKey);
    };
  }, [items.length, many, onClose]);

  if (!item) return null;

  function go(delta) {
    setI((x) => (x + delta + items.length) % items.length);
    setZoom(1);
  }

  function onImgClick(e) {
    if (item.type === "video") return;
    e.stopPropagation();
    if (zoom > 1) {
      setZoom(1);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setOrigin({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
    setZoom(2.4);
  }

  function onWheel(e) {
    if (item.type === "video") return;
    e.preventDefault();
    const next = e.deltaY < 0 ? Math.min(4, zoom + 0.25) : Math.max(1, zoom - 0.25);
    setZoom(next);
  }

  return (
    <div className="media-lb" onClick={onClose} role="presentation">
      <div className="media-lb-bar" onClick={(e) => e.stopPropagation()}>
        <div>
          <b>{item.label || (item.type === "video" ? "Video" : "Imagen")}</b>
          <span>
            {many ? `${i + 1} / ${items.length}` : ""}
            {item.type !== "video" ? " · Clic para ampliar · rueda para zoom · Esc para cerrar" : " · Esc para cerrar"}
          </span>
        </div>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      {many ? (
        <>
          <button className="media-lb-nav prev" type="button" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Anterior">‹</button>
          <button className="media-lb-nav next" type="button" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Siguiente">›</button>
        </>
      ) : null}
      <div className="media-lb-stage" ref={wrap} onWheel={onWheel} onClick={(e) => e.stopPropagation()}>
        {item.type === "video" ? (
          <div className="media-lb-video">
            <video src={item.src} controls autoPlay {...videoSilenceProps()} />
            <VideoMarks src={item.watermark || apiUrl("/catalog-media/watermark")} />
          </div>
        ) : (
          <img
            src={item.src}
            alt={item.label || ""}
            className={zoom > 1 ? "zoomed" : ""}
            style={{ transform: `scale(${zoom})`, transformOrigin: `${origin.x}% ${origin.y}%` }}
            onClick={onImgClick}
          />
        )}
      </div>
    </div>
  );
}

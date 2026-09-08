import { useEffect, useMemo, useRef, useState } from "react";

export default function SearchCreate({ options = [], value, onChange, onCreate, placeholder = "Buscar o crear…" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => String(o).toLowerCase().includes(needle));
  }, [options, q]);
  const exact = options.some((o) => String(o).toLowerCase() === q.trim().toLowerCase());

  useEffect(() => {
    function onDoc(e) {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="search-create" ref={box}>
      <input
        value={open ? q : (value || "")}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => { setOpen(true); setQ(value || ""); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {open ? (
        <div className="search-create-list">
          {list.map((o) => (
            <button
              key={o}
              type="button"
              className={o === value ? "on" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(o); setOpen(false); setQ(""); }}
            >
              {o}
            </button>
          ))}
          {q.trim() && !exact && onCreate ? (
            <button
              type="button"
              className="create"
              onMouseDown={(e) => e.preventDefault()}
              onClick={async () => {
                const created = await onCreate(q.trim());
                onChange(created || q.trim());
                setOpen(false);
                setQ("");
              }}
            >
              + Crear “{q.trim()}”
            </button>
          ) : null}
          {!list.length && (!q.trim() || exact) ? <div className="empty">Sin coincidencias</div> : null}
        </div>
      ) : null}
    </div>
  );
}

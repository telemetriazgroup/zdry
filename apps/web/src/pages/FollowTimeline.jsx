export default function FollowTimeline({ hits, compact }) {
  if (!hits?.length) return null;
  return (
    <ol className="follow-tl" style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
      {hits.map((h, i) => (
        <li
          key={h.key}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "baseline",
            padding: "4px 0",
            color: h.done ? "inherit" : "var(--muted, #888)",
          }}
        >
          <span style={{ fontWeight: 700 }}>{h.done ? "●" : "○"}</span>
          <span>
            {h.label}
            {!compact && h.detail && h.key === "draft" ? <span className="muted"> · {h.detail}</span> : null}
          </span>
          {i < hits.length - 1 ? <span className="muted" style={{ marginLeft: 4 }}>{h.done ? "→" : ""}</span> : null}
        </li>
      ))}
    </ol>
  );
}

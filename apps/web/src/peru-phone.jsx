export function localPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("51") && digits.length > 9) digits = digits.slice(2);
  return digits.slice(0, 9);
}

export function PeruPhone({ value, onChange, placeholder = "987 654 321", disabled = false, required = false }) {
  return (
    <span className="pe-phone">
      <span className="pe-flag" title="Perú">
        <svg viewBox="0 0 22 16" aria-hidden="true">
          <rect width="22" height="16" fill="#fff" />
          <rect width="7.34" height="16" fill="#D91023" />
          <rect x="14.66" width="7.34" height="16" fill="#D91023" />
        </svg>
        <b>51</b>
      </span>
      <input
        value={localPhone(value)}
        onChange={(e) => onChange(localPhone(e.target.value))}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="tel-national"
        disabled={disabled}
        required={required}
        maxLength={9}
      />
    </span>
  );
}

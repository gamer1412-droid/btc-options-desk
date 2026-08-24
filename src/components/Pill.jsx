import { T } from "../tokens.js";

export function Pill({ color, children }) {
  return (
    <span style={{
      background: color ? `${color}18` : T.bg3,
      color: color || T.textSecondary,
      border: `1px solid ${color ? `${color}38` : T.border}`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 11,
      fontFamily: T.fontSans,
      fontWeight: 700,
      letterSpacing: 0.5,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
    }}>
      {children}
    </span>
  );
}

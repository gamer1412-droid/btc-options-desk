import { T } from "../tokens.js";

export function Pill({ color, children }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontFamily: T.font,
      fontWeight: 700, letterSpacing: 1,
    }}>{children}</span>
  );
}

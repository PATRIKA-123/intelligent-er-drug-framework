// Our own friendly heart with a pulse line. Used only on login, empty states and
// success messages, never next to clinical data.
export default function Mascot({ size = 96, label = "Friendly heart mascot", outline = false }) {
  return (
    <svg viewBox="0 0 120 124" width={size} height={(size * 124) / 120} role="img" aria-label={label}>
      <path
        d="M60 100 C 20 70, 6 48, 6 32 C 6 16, 19 6, 33 6 C 44 6, 54 12, 60 22 C 66 12, 76 6, 87 6 C 101 6, 114 16, 114 32 C 114 48, 100 70, 60 100 Z"
        fill="#D3EAE3"
        stroke={outline ? "#15171C" : "none"}
        strokeWidth={outline ? 6 : 0}
      />
      <circle cx="44" cy="40" r="4.5" fill="#15171C" />
      <circle cx="76" cy="40" r="4.5" fill="#15171C" />
      <circle cx="33" cy="52" r="6" fill="#E7DEF6" />
      <circle cx="87" cy="52" r="6" fill="#E7DEF6" />
      <path d="M51 53 Q60 62 69 53" fill="none" stroke="#15171C" strokeWidth="3.5" strokeLinecap="round" />
      <path
        d="M2 112 H34 L42 100 L54 122 L64 106 L70 112 H118"
        fill="none"
        stroke={outline ? "#15171C" : "#E7DEF6"}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

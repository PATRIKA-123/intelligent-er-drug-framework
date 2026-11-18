import { Link } from "react-router";

const VARIANTS = {
  primary: "bg-ink text-white hover:bg-black",
  outline: "border border-ink bg-surface text-ink hover:bg-soft",
  mint: "bg-mint text-ink hover:brightness-95",
  disabled: "bg-line text-muted cursor-not-allowed",
};

// Fully round pill buttons. Pass `to` to render a link, otherwise a button.
export default function Button({ variant = "primary", to, disabled, className = "", children, ...rest }) {
  const look = disabled ? VARIANTS.disabled : VARIANTS[variant];
  const base = `inline-flex h-[52px] items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition ${look} ${className}`;
  if (to && !disabled) return <Link to={to} className={base} {...rest}>{children}</Link>;
  return <button type="button" disabled={disabled} className={base} {...rest}>{children}</button>;
}

// Brand mark: the friendly heart with a pulse line (outlined, for light backgrounds).
// With `badge` it sits on a white circle so it also reads on dark backgrounds.
import Mascot from "./Mascot";

export default function Logo({ size = 32, badge = false, label = "" }) {
  if (!badge) return <Mascot size={size} outline label={label} />;
  return (
    <span className="flex items-center justify-center rounded-full bg-white" style={{ width: size, height: size }}>
      <Mascot size={size * 0.68} outline label={label} />
    </span>
  );
}

import Logo from "./Logo";
import { APP_NAME, APP_TAGLINE } from "../lib/terms";

// Floating brand pill for the dark sign-in screens (the light app uses the nav pill instead).
export default function BrandPill() {
  return (
    <div className="flex items-center gap-3 rounded-full border border-white/20 bg-[rgba(18,20,28,0.78)] py-2 pl-2 pr-6 shadow-xl">
      <Logo size={44} badge label="" />
      <span className="text-[22px] font-semibold lowercase leading-none tracking-tight text-white">
        {APP_NAME.toLowerCase()}<span className="text-mint">.</span>
      </span>
      <span aria-hidden className="hidden h-5 w-px bg-white/25 sm:block" />
      <span className="hidden text-xs text-[#C9CED8] sm:block">{APP_TAGLINE}</span>
    </div>
  );
}

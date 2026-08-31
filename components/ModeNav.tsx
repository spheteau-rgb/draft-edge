"use client";

/**
 * The draft and the season are two different jobs sharing one deployment. This
 * is the only thing telling you which one you are looking at, and it stays put
 * so switching between them mid-week is one tap on a phone.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const MODES = [
  { href: "/week", label: "Season" },
  { href: "/", label: "Draft" },
];

export default function ModeNav() {
  const pathname = usePathname();
  return (
    <nav className="mode-nav" aria-label="Mode">
      {MODES.map((m) => (
        <Link
          key={m.href}
          href={m.href}
          className={pathname === m.href ? "mode-nav-link mode-nav-active" : "mode-nav-link"}
          aria-current={pathname === m.href ? "page" : undefined}
        >
          {m.label}
        </Link>
      ))}
    </nav>
  );
}

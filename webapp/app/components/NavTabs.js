"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Sheriff Sales" },
  { href: "/nts", label: "NTS (Trustee Sale)" },
  { href: "/purchased", label: "Purchased" },
];

export default function NavTabs() {
  const pathname = usePathname();
  return (
    <div className="navTabs">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`navTab ${pathname === tab.href ? "active" : ""}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

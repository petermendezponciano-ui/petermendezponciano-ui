"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; d: string };

export default function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <ul className="sidebar-nav">
      {items.map((item) => {
        const activo =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link href={item.href} className={activo ? "active" : undefined}>
              <span className="nav-icon">
                <svg
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.d} />
                </svg>
              </span>
              <span className="nav-label">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

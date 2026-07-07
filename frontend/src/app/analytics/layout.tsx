"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ANALYTICS_TABS = [
  { href: "/analytics/raids", label: "Raid Analytics" },
  { href: "/analytics/compare", label: "Compare" },
  { href: "/analytics/network", label: "Character Guild Network" },
] as const;

function tabClass(active: boolean) {
  return `inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold transition-[background-color,color,box-shadow,scale] active:scale-[0.96] ${
    active
      ? "bg-blue-600 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.35),0_10px_28px_rgba(37,99,235,0.2)]"
      : "bg-gray-900/75 text-gray-400 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-gray-800/80 hover:text-gray-100 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.13)]"
  }`;
}

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/analytics" || pathname === "/analytics/network") {
    return <div className="w-full">{children}</div>;
  }

  return (
    <div className="w-full">
      <div className="px-4 md:px-6">
        <div className="mb-4 flex flex-col gap-3 border-b border-gray-800 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white text-balance md:text-3xl">Analytics</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500 text-pretty">Raid performance and long-term raider movement across tracked guilds.</p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Analytics views">
            {ANALYTICS_TABS.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link key={tab.href} href={tab.href} className={tabClass(active)} aria-current={active ? "page" : undefined}>
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}

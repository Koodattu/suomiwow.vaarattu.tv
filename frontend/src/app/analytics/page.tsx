"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FaArrowRight, FaChartLine, FaCrosshairs, FaNetworkWired, FaScaleBalanced } from "react-icons/fa6";

const ANALYTICS_OPTIONS = [
  {
    href: "/analytics/raids",
    key: "raids",
    Icon: FaChartLine,
    iconClass: "bg-blue-500/15 text-blue-200 shadow-[0_0_0_1px_rgba(96,165,250,0.22)]",
    hoverShadow: "hover:shadow-[0_0_0_1px_rgba(96,165,250,0.4)]",
  },
  {
    href: "/analytics/compare",
    key: "compare",
    Icon: FaScaleBalanced,
    iconClass: "bg-amber-500/15 text-amber-200 shadow-[0_0_0_1px_rgba(251,191,36,0.22)]",
    hoverShadow: "hover:shadow-[0_0_0_1px_rgba(251,191,36,0.4)]",
  },
  {
    href: "/analytics/network",
    key: "network",
    Icon: FaNetworkWired,
    iconClass: "bg-emerald-500/15 text-emerald-200 shadow-[0_0_0_1px_rgba(52,211,153,0.22)]",
    hoverShadow: "hover:shadow-[0_0_0_1px_rgba(52,211,153,0.4)]",
  },
  {
    href: "/analytics/mechanics",
    key: "mechanics",
    Icon: FaCrosshairs,
    iconClass: "bg-rose-500/15 text-rose-200 shadow-[0_0_0_1px_rgba(251,113,133,0.22)]",
    hoverShadow: "hover:shadow-[0_0_0_1px_rgba(251,113,133,0.4)]",
  },
] as const;

export default function AnalyticsPage() {
  const t = useTranslations("analyticsLanding");
  return (
    <main className="min-h-[calc(100vh-5rem)] px-4 py-6 text-white md:px-6 md:py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="max-w-3xl">
          <h1 className="text-2xl font-bold text-balance md:text-3xl">{t("eyebrow")}</h1>
          <p className="mt-2 text-sm text-gray-400 text-pretty md:text-base">{t("description")}</p>
        </header>

        <ul className="grid gap-3 md:grid-cols-2">
          {ANALYTICS_OPTIONS.map(({ href, key, Icon, iconClass, hoverShadow }) => (
            <li key={href}>
              <Link
                href={href}
                className={`group flex h-full items-start gap-4 rounded-lg bg-gray-900 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-[background-color,box-shadow] duration-150 ease-out hover:bg-gray-800/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:bg-gray-800 md:p-5 ${hoverShadow}`}
              >
                <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${iconClass}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-balance">{t(`${key}.title`)}</h2>
                    <FaArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-500 transition-[color,transform] duration-150 ease-out group-hover:translate-x-1 group-hover:text-white motion-reduce:transition-none" aria-hidden="true" />
                  </div>
                  <p className="mt-1 text-sm leading-6 text-gray-400 text-pretty">{t(`${key}.description`)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

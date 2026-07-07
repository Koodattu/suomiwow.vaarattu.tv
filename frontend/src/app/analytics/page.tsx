import Link from "next/link";
import { FaArrowRight, FaChartLine, FaNetworkWired, FaScaleBalanced } from "react-icons/fa6";

const ANALYTICS_OPTIONS = [
  {
    href: "/analytics/raids",
    title: "Raid Analytics",
    description: "Inspect progression, boss kills, raid activity, and performance trends across tracked guilds.",
    Icon: FaChartLine,
    iconClass: "bg-blue-500/15 text-blue-200 shadow-[0_0_0_1px_rgba(96,165,250,0.22)]",
    hoverShadow: "hover:shadow-[0_0_0_1px_rgba(96,165,250,0.28),0_18px_50px_rgba(37,99,235,0.16)]",
  },
  {
    href: "/analytics/compare",
    title: "Compare",
    description: "Compare guild tier metrics by progress, pulls, raid time, combat time, and boss kills.",
    Icon: FaScaleBalanced,
    iconClass: "bg-amber-500/15 text-amber-200 shadow-[0_0_0_1px_rgba(251,191,36,0.22)]",
    hoverShadow: "hover:shadow-[0_0_0_1px_rgba(251,191,36,0.28),0_18px_50px_rgba(217,119,6,0.14)]",
  },
  {
    href: "/analytics/network",
    title: "Character Guild Network",
    description: "Explore character movement and guild relationships as a connected network view.",
    Icon: FaNetworkWired,
    iconClass: "bg-emerald-500/15 text-emerald-200 shadow-[0_0_0_1px_rgba(52,211,153,0.22)]",
    hoverShadow: "hover:shadow-[0_0_0_1px_rgba(52,211,153,0.28),0_18px_50px_rgba(5,150,105,0.14)]",
  },
] as const;

export default function AnalyticsPage() {
  return (
    <main className="min-h-[calc(100vh-5rem)] px-4 py-8 text-white md:px-6 md:py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-300">Analytics</p>
          <h1 className="mt-3 text-3xl font-bold text-balance md:text-5xl">Choose an analytics view</h1>
          <p className="mt-4 max-w-2xl text-base text-gray-400 text-pretty md:text-lg">Start with raid progression metrics, compare guild effort, or open the character guild network for relationship and movement analysis.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {ANALYTICS_OPTIONS.map(({ href, title, description, Icon, iconClass, hoverShadow }) => (
            <Link
              key={href}
              href={href}
              className={`group flex min-h-64 flex-col justify-between rounded-lg bg-gray-900 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_18px_50px_rgba(0,0,0,0.22)] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:bg-gray-800/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.96] ${hoverShadow}`}
            >
              <div>
                <span className={`inline-flex h-14 w-14 items-center justify-center rounded-md ${iconClass}`}>
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <h2 className="mt-6 text-2xl font-bold text-balance">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-gray-400 text-pretty">{description}</p>
              </div>
              <span className="mt-8 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-gray-200 transition-colors group-hover:text-white">
                Open view
                <FaArrowRight className="h-4 w-4 transition-transform duration-150 ease-out group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

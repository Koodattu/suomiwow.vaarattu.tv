"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function ToolsPortalPage() {
  const t = useTranslations("tools");

  return (
    <main className="min-h-[70vh] bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.1),transparent_34%),linear-gradient(to_bottom,#080d18,#0f172a)] px-4 py-8 text-white sm:py-12">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-balance text-4xl font-black tracking-[-0.03em] sm:text-5xl">{t("portal.title")}</h1>

        <section className="mt-7" aria-label={t("portal.availableTools")}>
          <Link
            href="/tools/rclc"
            className="group relative flex min-h-44 max-w-2xl overflow-hidden rounded-xl border border-cyan-300/20 bg-gradient-to-br from-cyan-500/15 to-slate-950 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.25)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-1 hover:border-cyan-300/40 hover:shadow-[0_22px_55px_rgba(8,145,178,0.18)] active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 motion-reduce:transform-none motion-reduce:transition-none sm:p-6"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="grid size-11 place-items-center rounded-lg bg-cyan-400/10 text-2xl font-black text-cyan-200 ring-1 ring-cyan-300/20" aria-hidden="true">⇄</span>
              <span className="mt-4 text-2xl font-black">{t("rclc.cardTitle")}</span>
              <span className="mt-1 max-w-xl text-sm leading-6 text-slate-300">{t("rclc.cardDescription")}</span>
              <span className="mt-auto inline-flex items-center gap-2 pt-4 text-xs font-black uppercase tracking-wider text-cyan-200">
                {t("portal.open")} <span className="transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden="true">→</span>
              </span>
            </span>
          </Link>
        </section>
      </div>
    </main>
  );
}

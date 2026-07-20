"use client";

import { useTranslations } from "next-intl";

export default function PickemsRules() {
  const t = useTranslations("pickemsRulesPage");

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold mb-8">Pickems Rules & Info</h1>

      <div className="space-y-6 text-gray-300">
        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">1. What Are Pickems?</h2>
          <p>
            Pickems is our community prediction game! Before a new raid tier launches, you predict the order in which Finnish WoW guilds will clear the content. Think you know
            which guild will get Cutting Edge first? Put your predictions where your mouth is. We also run RWF (Race to World First) pickems where you predict from a pool of top
            global guilds. It&apos;s all about bragging rights, fun, and maybe some shiny gold.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">2. How It Works</h2>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>{t("participation")}</li>
            <li>Find an active pickem on the Pickems page</li>
            <li>Drag and drop guilds into your predicted finishing order</li>
            <li>Submit your predictions before the deadline</li>
            <li>Once the raid tier plays out, your predictions are scored automatically</li>
          </ul>
          <p className="mt-3">
            Each pickem has its own deadline — make sure you get your picks in on time! You can update your predictions as many times as you want before the deadline closes.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">3. {t("guestTitle")}</h2>
          <p>{t("guestDescription")}</p>
          <ul className="mt-3 list-disc list-inside space-y-1 ml-2">
            <li>{t("guestLocalOnly")}</li>
            <li>{t("guestEligibility")}</li>
            <li>{t("guestImport")}</li>
            <li>{t("guestDeadline")}</li>
            <li>{t("guestExisting")}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">4. Scoring</h2>
          <p className="mb-3">Your score is based on how close your predicted position is to each guild&apos;s actual finishing position. The default scoring system is:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Exact match</strong> — 10 points
            </li>
            <li>
              <strong>Off by 1</strong> — 8 points
            </li>
            <li>
              <strong>Off by 2</strong> — 6 points
            </li>
            <li>
              <strong>Off by 3</strong> — 4 points
            </li>
            <li>
              <strong>Off by 4</strong> — 2 points
            </li>
            <li>
              <strong>Off by 5 or more</strong> — 0 points
            </li>
          </ul>
          <p className="mt-3">
            Points are totaled across all guilds in the pickem. The higher your total score, the better your predictions were. Note that the scoring system and point values may
            vary between pickems — the admin can configure these per pickem, so always check the details on each one.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">5. Prizes</h2>
          <p className="mb-3">
            The site creator may offer World of Warcraft in-game gold as prizes for top finishers. This is done purely for fun and to give the community something extra to compete
            for.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Prizes are in-game WoW gold only — no real money is ever involved</li>
            <li>Prize amounts are set by the site creator and may vary per pickem</li>
            <li>Prizes are provided at the sole discretion of the site creator and are not guaranteed</li>
            <li>Distribution details (amount, timing, eligibility) are announced with each pickem</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">6. Fair Play</h2>
          <p className="mb-3">Keep it fair and fun for everyone:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>One entry per user per pickem — don&apos;t create multiple accounts</li>
            <li>No exploiting bugs or manipulating the system</li>
            <li>Entries may be removed and users may be disqualified if abuse or cheating is detected</li>
            <li>The site creator reserves the right to make final decisions on any disputes</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">7. Important Notes</h2>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Pickems is a community game run entirely for fun — it is not gambling</li>
            <li>No real money is involved at any point, only in-game WoW gold</li>
            <li>Everything is provided &quot;as is&quot; with no guarantees</li>
            <li>Rules, scoring, prizes, and features may change at any time without notice</li>
            <li>The site creator has final say on all pickem-related matters</li>
          </ul>
        </section>

        <div className="mt-8 pt-6 border-t border-gray-700 text-sm text-gray-400">
          <p>Last updated: July 20, 2026</p>
        </div>
      </div>
    </div>
  );
}

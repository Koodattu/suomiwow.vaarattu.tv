"use client";

import { useTranslations } from "next-intl";

export default function PrivacyPolicy() {
  const t = useTranslations("siteAnalytics");
  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>

      <div className="space-y-6 text-gray-300">
        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">1. Introduction</h2>
          <p>
            This Privacy Policy explains what information WoW Guild Progress Tracker collects, how we use it, and your choices. We believe in being straightforward — no legal
            jargon, just an honest description of how things work.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">2. Information We Collect</h2>
          <p className="mb-3">When you use our service, we may collect the following information depending on which features you use:</p>

          <h3 className="text-lg font-medium mb-2 text-white">Discord Login</h3>
          <p className="mb-2">
            When you log in with Discord, we receive and store your Discord ID, username, email address, and profile picture through Discord&apos;s OAuth system. This is used to
            create and manage your account.
          </p>

          <h3 className="text-lg font-medium mb-2 text-white">Battle.net Connection (optional)</h3>
          <p className="mb-2">
            If you choose to connect your Battle.net account, we receive and store your Battle.net ID and your World of Warcraft character list (name, realm, class, level). You
            choose which characters to associate with your profile.
          </p>

          <h3 className="text-lg font-medium mb-2 text-white">Twitch Connection (optional)</h3>
          <p className="mb-2">If you choose to connect your Twitch account, we receive and store your Twitch username and channel information.</p>

          <h3 className="text-lg font-medium mb-2 text-white">Session Cookies</h3>
          <p className="mb-2">We use cookies solely to maintain your login session. We do not use tracking cookies of any kind.</p>

          <h3 className="text-lg font-medium mb-2 text-white">{t("privacyTitle")}</h3>
          <p className="mb-2">{t("privacyAudience")}</p>
          <p>{t("privacyRetention")}</p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">3. How We Use Your Information</h2>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>To provide and maintain your user account</li>
            <li>To associate your WoW characters with your profile (if you choose to connect Battle.net)</li>
            <li>To display your Twitch stream status (if you choose to connect Twitch)</li>
            <li>To maintain your login session</li>
            <li>{t("privacyPurpose")}</li>
            <li>To debug technical issues via server logs</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">4. What We Don&apos;t Do</h2>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>We do not run ads or use ad tracking</li>
            <li>We do not use third-party analytics services (no Google Analytics, etc.)</li>
            <li>We do not sell, share, or give your personal data to third parties</li>
            <li>We do not use tracking cookies</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">5. Third-Party Services</h2>
          <p className="mb-2">
            When you log in or connect accounts, you interact with Discord, Battle.net, and Twitch through their OAuth systems. Each of these services has its own privacy policy
            that governs how they handle your data on their end:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4 mb-3">
            <li>Discord — discord.com/privacy</li>
            <li>Battle.net — blizzard.com/legal/a4380ee5-5c8d-4e3b-83b7-ea26d01a9918</li>
            <li>Twitch — twitch.tv/p/legal/privacy-notice</li>
          </ul>
          <p>
            All guild, raid, and character game data displayed on this site comes from publicly available sources: Warcraft Logs, Raider.IO, and Blizzard&apos;s official API. This
            data is already public.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">6. Data Security</h2>
          <p>
            We take reasonable measures to protect your data, including secure session handling and encrypted connections. That said, this is a community hobby project — not a
            Fortune 500 company. We do our best to keep things secure, but no system is perfect.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">7. Your Rights</h2>
          <p className="mb-2">You have control over your data:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>You can disconnect your Battle.net or Twitch accounts at any time from your profile settings</li>
            <li>You can request deletion of your account and all associated data by contacting us via Discord</li>
            <li>For concerns about game data displayed from public APIs, contact those services directly (Blizzard, Warcraft Logs, Raider.IO)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">8. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date. Continued use of the service after changes means you
            accept the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3 text-white">9. Contact</h2>
          <p>If you have questions about this Privacy Policy or want to request data deletion, reach out via our Discord server or GitHub repository.</p>
        </section>

        <div className="mt-8 pt-6 border-t border-gray-700 text-sm text-gray-400">
          <p>{t("privacyUpdated")}</p>
        </div>
      </div>
    </div>
  );
}

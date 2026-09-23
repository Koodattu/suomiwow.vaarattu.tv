"use client";

import { useTranslations } from "next-intl";

export default function BattleNetAccessHelp({ code }: { code?: string | null }) {
  const t = useTranslations("profilePage");
  if (!code || !["battlenet_permission_required", "battlenet_profile_access_denied", "battlenet_profile_unavailable"].includes(code)) return null;
  return <div className="mt-2 flex flex-wrap gap-4 text-sm">
    <a className="underline" href="https://account.battle.net/connections#authorized-applications" target="_blank" rel="noopener noreferrer">{t("battleNetPermissions")}</a>
    <a className="underline" href="https://account.battle.net/privacy" target="_blank" rel="noopener noreferrer">{t("battleNetPrivacy")}</a>
  </div>;
}

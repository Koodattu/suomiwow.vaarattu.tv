"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { CharacterAccountResponse } from "@/types";
import { formatRealmName, getClassInfoById } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import { RaidAchievementMetric } from "@/components/RaidAchievementMetric";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const CLASS_COLORS: Record<string, string> = {
  "Death Knight": "#C41E3A",
  "Demon Hunter": "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

function getClassColor(className: string) {
  return CLASS_COLORS[className] ?? "#D1D5DB";
}

function formatShortDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "-";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function getCharacterProfileHref(realm: string, name: string, classID: number) {
  return `/characters/${encodeURIComponent(realm)}/${encodeURIComponent(name)}?class=${encodeURIComponent(String(classID))}`;
}

function AccountCharacterRow({ character }: { character: CharacterAccountResponse["characters"][number] }) {
  const classInfo = getClassInfoById(character.classID);
  const tRaidAchievements = useTranslations("raidAchievements");
  const ceCount = character.raidAchievements?.cuttingEdgeCount;
  const aotcCount = character.raidAchievements?.aheadOfTheCurveCount;

  return (
    <Link
      href={getCharacterProfileHref(character.realm, character.name, character.classID)}
      className="grid min-h-[72px] grid-cols-[40px_minmax(0,1fr)_64px_64px_80px] items-center gap-3 border-b border-gray-800 px-4 py-3 transition-colors last:border-0 hover:bg-gray-800/45 focus-visible:bg-gray-800/45 focus-visible:outline focus-visible:outline-blue-400 md:grid-cols-[44px_minmax(0,1fr)_84px_84px_120px_120px]"
    >
      <span className="relative h-10 w-10 overflow-hidden rounded md:h-11 md:w-11">
        <IconImage iconFilename={classInfo.iconUrl} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-base font-bold" style={{ color: getClassColor(classInfo.name) }}>
            {character.name}
          </span>
          <span className="shrink-0 text-sm font-semibold text-gray-500">{formatRealmName(character.realm)}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-sm text-gray-500">
          <span className="truncate">{character.guildName ?? "No guild"}</span>
          <span className="shrink-0 tabular-nums md:hidden">{formatShortDate(character.lastSeenAt ?? character.lastMythicSeenAt)}</span>
        </span>
      </span>
      <span className="text-right text-sm font-semibold tabular-nums text-gray-300" title={tRaidAchievements("cuttingEdge")}>
        {ceCount ?? "-"}
      </span>
      <span className="text-right text-sm font-semibold tabular-nums text-gray-300" title={tRaidAchievements("aheadOfTheCurve")}>
        {aotcCount ?? "-"}
      </span>
      <span className="text-right text-sm font-semibold tabular-nums text-gray-300">{character.reportCount}</span>
      <span className="hidden text-right text-sm tabular-nums text-gray-400 md:block">{formatShortDate(character.lastSeenAt ?? character.lastMythicSeenAt)}</span>
    </Link>
  );
}

export default function AccountPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const tRaidAchievements = useTranslations("raidAchievements");
  const tAccountProfile = useTranslations("accountProfile");
  const slug = decodeURIComponent(resolvedParams.slug);
  const [account, setAccount] = useState<CharacterAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      setLoading(true);
      setError(null);

      try {
        const response = await api.getCharacterAccount(slug);
        if (!cancelled) setAccount(response);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load account");
          setAccount(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAccount();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <main className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-5xl text-center text-gray-300">Loading account...</div>
      </main>
    );
  }

  if (error || !account) {
    return (
      <main className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-5xl rounded-lg border border-gray-700 bg-gray-900 p-8 text-center">
          <h1 className="text-xl font-semibold text-white">Account not found</h1>
          <p className="mt-2 text-sm text-gray-400">{error ?? "No inferred character account exists for this link."}</p>
        </div>
      </main>
    );
  }

  const mostSeenCharacter = account.characters[0];
  const primaryClass = mostSeenCharacter ? getClassInfoById(mostSeenCharacter.classID) : null;
  const accountAchievements = account.account.raidAchievements?.achievements ?? [];

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="py-2">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              {primaryClass ? (
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded md:h-16 md:w-16">
                  <IconImage iconFilename={primaryClass.iconUrl} alt={primaryClass.name} fill style={{ objectFit: "cover" }} />
                </span>
              ) : null}
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-bold text-white md:text-4xl">{mostSeenCharacter?.name ?? account.account.displayName}</h1>
                <p className="mt-1 text-sm font-semibold text-gray-500">
                  {tAccountProfile("mostSeenCharacter")}
                  {mostSeenCharacter ? ` - ${formatRealmName(mostSeenCharacter.realm)}` : ""}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 md:text-right">
              <div>
                <div className="text-gray-500">Characters</div>
                <div className="text-xl font-bold tabular-nums text-gray-100">{account.account.characterCount}</div>
              </div>
              <div>
                <div className="text-gray-500">Reports</div>
                <div className="text-xl font-bold tabular-nums text-gray-100">{account.account.totalReportCount}</div>
              </div>
              <div>
                <RaidAchievementMetric
                  type="cutting_edge"
                  title={tRaidAchievements("cuttingEdge")}
                  shortTitle={tRaidAchievements("cuttingEdgeShort")}
                  count={account.account.raidAchievements?.cuttingEdgeCount}
                  achievements={accountAchievements.filter((achievement) => achievement.type === "cutting_edge")}
                />
              </div>
              <div>
                <RaidAchievementMetric
                  type="ahead_of_the_curve"
                  title={tRaidAchievements("aheadOfTheCurve")}
                  shortTitle={tRaidAchievements("aheadOfTheCurveShort")}
                  count={account.account.raidAchievements?.aheadOfTheCurveCount}
                  achievements={accountAchievements.filter((achievement) => achievement.type === "ahead_of_the_curve")}
                />
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-lg border border-gray-700 bg-gray-900">
          <div className="grid grid-cols-[40px_minmax(0,1fr)_64px_64px_80px] gap-3 border-b border-gray-700 px-4 py-3 text-xs font-semibold uppercase text-gray-500 md:grid-cols-[44px_minmax(0,1fr)_84px_84px_120px_120px]">
            <span />
            <span>Character</span>
            <span className="text-right">{tRaidAchievements("cuttingEdgeShort")}</span>
            <span className="text-right">{tRaidAchievements("aheadOfTheCurveShort")}</span>
            <span className="text-right">Reports</span>
            <span className="hidden text-right md:block">Last Seen</span>
          </div>
          {account.characters.map((character) => (
            <AccountCharacterRow key={character.characterId} character={character} />
          ))}
        </section>
      </div>
    </main>
  );
}

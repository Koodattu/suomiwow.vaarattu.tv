"use client";

import Link from "next/link";
import { use } from "react";
import { useTranslations } from "next-intl";
import { CharacterTierListSnapshotBoard } from "@/components/character-tier-lists/CustomCharacterTierListMaker";
import { useSharedCharacterTierList } from "@/lib/queries";

interface PageProps {
  params: Promise<{ realm: string; name: string; raidId: string; shareId: string }>;
}

export default function SharedGuildCharacterTierListPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const t = useTranslations("characterTierListsPage");
  const realm = decodeURIComponent(resolvedParams.realm);
  const name = decodeURIComponent(resolvedParams.name);
  const raidId = parseInt(resolvedParams.raidId, 10);
  const shareId = decodeURIComponent(resolvedParams.shareId);
  const { data, isLoading, error } = useSharedCharacterTierList(shareId, !!shareId);

  const editPath = `/guilds/${encodeURIComponent(data?.guild.realm ?? realm)}/${encodeURIComponent(data?.guild.name ?? name)}/raids/${data?.raid.id ?? raidId}/tierlist?fromShare=${encodeURIComponent(shareId)}`;
  const generatedPath = `/guilds/${encodeURIComponent(data?.guild.realm ?? realm)}/${encodeURIComponent(data?.guild.name ?? name)}/raids/${data?.raid.id ?? raidId}/tierlist`;

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-6 text-white md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm text-gray-400">
              {data ? `${data.guild.name} / ${data.guild.realm}` : `${name} / ${realm}`}
            </p>
            <h1 className="text-3xl font-bold">{t("sharedTitle")}</h1>
            <p className="mt-2 text-sm text-gray-400">{data ? t(data.share.canEdit ? "sharedOwnerHint" : "sharedReadOnlyHint") : t("sharedReadOnlyHint")}</p>
            {data?.share.updatedAt && <p className="mt-1 text-xs text-gray-500">{t("lastUpdated", { date: new Date(data.share.updatedAt).toLocaleString() })}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href={editPath} className="inline-flex min-h-10 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-[scale,background-color] duration-150 ease-out hover:bg-blue-500 active:scale-[0.96]">
              {data?.share.canEdit ? t("editSharedTierList") : t("makeEditable")}
            </Link>
            <Link href={generatedPath} className="inline-flex min-h-10 items-center rounded-md border border-gray-600 px-4 text-sm font-semibold text-gray-100 transition-[scale,background-color] duration-150 ease-out hover:bg-gray-800 active:scale-[0.96]">
              {t("viewGeneratedTierList")}
            </Link>
          </div>
        </div>

        {isLoading && <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-8 text-center text-gray-400">{t("loading")}</div>}
        {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-8 text-center text-red-200">{t("sharedLoadFailed")}</div>}
        {!isLoading && !error && data && <CharacterTierListSnapshotBoard data={data} />}
      </div>
    </main>
  );
}

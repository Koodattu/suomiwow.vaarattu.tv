"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useGuildNetworkMeta } from "@/lib/queries";
import { useLocale, useTranslations } from "next-intl";

function withVersion(url: string, etag?: string): string {
  if (!etag) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(etag)}`;
}

function getNetworkUrl(configuredUrl: string, sameOriginPath: string, etag?: string): string {
  if (typeof window === "undefined") {
    return withVersion(sameOriginPath, etag);
  }

  try {
    const parsed = new URL(configuredUrl, window.location.origin);
    const currentHostIsLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const configuredHostIsLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

    if (parsed.origin === window.location.origin || (configuredHostIsLocal && !currentHostIsLocal)) {
      return withVersion(sameOriginPath, etag);
    }
  } catch {
    return withVersion(sameOriginPath, etag);
  }

  return withVersion(configuredUrl, etag);
}

function injectNetworkConfig(
  html: string,
  universeUrl: string,
  movementUrlTemplate: string,
  movementReady: boolean,
  copy: string,
  locale: string,
): string {
  return html
    .replace(
      'const universeUrl = params.get("universe") || "/api/guild-network/universe";',
      `const universeUrl = ${JSON.stringify(universeUrl)};`,
    )
    .replace(
      'const movementUrlTemplate = "/api/guild-network/raids/{raidId}/movement";',
      `const movementUrlTemplate = ${JSON.stringify(movementUrlTemplate)};`,
    )
    .replace("const movementReady = true;", `const movementReady = ${JSON.stringify(movementReady)};`)
    .replace("const networkCopy = {};", `const networkCopy = ${copy};`)
    .replace('const networkLocale = "en";', `const networkLocale = ${JSON.stringify(locale)};`);
}

export default function GuildNetworkView() {
  const t = useTranslations("guildNetwork");
  const locale = useLocale();
  const { data: meta, isPending: isMetaPending } = useGuildNetworkMeta();
  const [networkShell, setNetworkShell] = useState<{ srcDoc: string; universeUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const universeUrl = useMemo(() => {
    return getNetworkUrl(api.getGuildNetworkUniverseUrl(), "/api/guild-network/universe", meta?.etag);
  }, [meta?.etag]);
  const movementUrlTemplate = useMemo(() => {
    return getNetworkUrl(api.getGuildNetworkMovementUrlTemplate(), "/api/guild-network/raids/{raidId}/movement", meta?.etag);
  }, [meta?.etag]);
  const copy = useMemo(
    () =>
      JSON.stringify({
        iframeTitle: t("iframeTitle"),
        shellLoadError: t("shellLoadError"),
        view: t("view"),
        selectedRaid: t("selectedRaid"),
        allRaids: t("allRaids"),
        roster: t("roster"),
        movement: t("movement"),
        combined: t("combined"),
        lineages: t("lineages"),
        character: t("character"),
        characters: t("characters"),
        accounts: t("accounts"),
        filters: t("filters"),
        minimumRosterReports: t("minimumRosterReports"),
        minimumStintReports: t("minimumStintReports"),
        filterEveryone: t("filterEveryone"),
        filterRegulars: t("filterRegulars"),
        filterCore: t("filterCore"),
        filterCommitted: t("filterCommitted"),
        filterDieHards: t("filterDieHards"),
        filterAllStints: t("filterAllStints"),
        filterEstablishedStints: t("filterEstablishedStints"),
        filterLongStints: t("filterLongStints"),
        filterSustainedStints: t("filterSustainedStints"),
        filterCoreStints: t("filterCoreStints"),
        migrationFlows: t("migrationFlows"),
        movementFlows: t("movementFlows"),
        migrationLines: t("migrationLines"),
        crossGuildFibers: t("crossGuildFibers"),
        guildLabels: t("guildLabels"),
        resetView: t("resetView"),
        clearSelection: t("clearSelection"),
        search: t("search"),
        searchAllPlaceholder: t("searchAllPlaceholder"),
        searchCharacterPlaceholder: t("searchCharacterPlaceholder"),
        loadingUniverseTitle: t("loadingUniverseTitle"),
        loadingUniverseBody: t("loadingUniverseBody"),
        loadingMovementTitle: t("loadingMovementTitle"),
        loadingMovementBody: t("loadingMovementBody"),
        errorTitle: t("errorTitle"),
        movementLoadError: t("movementLoadError"),
        movementUnavailable: t("movementUnavailable"),
        movementEmptyTitle: t("movementEmptyTitle"),
        movementEmptyBody: t("movementEmptyBody"),
        movementDescription: t("movementDescription"),
        accountMovementDescription: t("accountMovementDescription"),
        movementSummary: t("movementSummary"),
        biggestFlows: t("biggestFlows"),
        noObservedChanges: t("noObservedChanges"),
        noStintsUnderFilter: t("noStintsUnderFilter"),
        entitiesObserved: t("entitiesObserved"),
        guildsObserved: t("guildsObserved"),
        multiGuildEntities: t("multiGuildEntities"),
        observedChanges: t("observedChanges"),
        reportObservations: t("reportObservations"),
        wholeTier: t("wholeTier"),
        raidSelectorLabel: t("raidSelectorLabel"),
        timelineLabel: t("timelineLabel"),
        playMovement: t("playMovement"),
        pauseMovement: t("pauseMovement"),
        playTiers: t("playTiers"),
        pauseTiers: t("pauseTiers"),
        stints: t("stints"),
        reports: t("reports"),
        firstSeenWith: t("firstSeenWith"),
        changedTo: t("changedTo"),
        responsibleAlt: t("responsibleAlt"),
        observedFrom: t("observedFrom"),
        observedTo: t("observedTo"),
        ambiguousTitle: t("ambiguousTitle"),
        ambiguousBody: t("ambiguousBody"),
        clickMovementEntity: t("clickMovementEntity"),
        inferredAccount: t("inferredAccount"),
        singleCharacter: t("singleCharacter"),
        linkedCharacters: t("linkedCharacters"),
        guild: t("guild"),
        account: t("account"),
        report: t("report"),
        loadingLayout: t("loadingLayout"),
        recomputing: t("recomputing"),
      }).replaceAll("<", "\\u003c"),
    [t],
  );

  useEffect(() => {
    if (isMetaPending) return;

    let active = true;
    const controller = new AbortController();

    fetch("/guild-network-poc/index.html", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(t("shellLoadError"));
        return response.text();
      })
      .then((html) => {
        if (!active) return;
        setNetworkShell({
          srcDoc: injectNetworkConfig(html, universeUrl, movementUrlTemplate, meta?.movementReady === true, copy, locale),
          universeUrl,
        });
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : t("shellLoadError"));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [copy, isMetaPending, locale, meta?.movementReady, movementUrlTemplate, t, universeUrl]);

  return (
    <div className="h-[calc(100vh-5rem)] min-h-[640px] w-full overflow-hidden bg-[#050711]">
      {error ? (
        <div className="grid h-full place-items-center px-4 text-sm font-semibold text-red-200">{error}</div>
      ) : networkShell ? (
        <iframe
          key={`${networkShell.universeUrl}:${locale}:${meta?.movementReady === true}`}
          srcDoc={networkShell.srcDoc}
          title={t("iframeTitle")}
          className="block h-full w-full border-0"
          loading="eager"
        />
      ) : (
        <div className="grid h-full place-items-center px-4 text-sm font-semibold text-slate-300">{t("shellLoading")}</div>
      )}
    </div>
  );
}

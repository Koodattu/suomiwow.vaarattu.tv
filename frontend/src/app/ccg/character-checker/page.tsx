"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FormEvent, useState } from "react";
import {
  FaArrowUpRightFromSquare,
  FaCalendarDay,
  FaCircleCheck,
  FaCircleXmark,
  FaImage,
  FaLayerGroup,
  FaMagnifyingGlass,
  FaTriangleExclamation,
} from "react-icons/fa6";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import CcgShell from "@/components/ccg/CcgShell";
import styles from "@/components/ccg/ccg.module.css";
import { CCG_CLASS_COLORS, CCG_RARITY_COLORS } from "@/lib/ccg";
import { useCcgCharacterCheck } from "@/lib/queries";
import { formatRealmName } from "@/lib/utils";
import type { CcgCharacterCheckResponse } from "@/types";

type FoundCharacterCheck = Extract<CcgCharacterCheckResponse, { found: true }>;

function CharacterResult({ result }: { result: FoundCharacterCheck }) {
  const t = useTranslations("ccg.characterChecker");
  const status = result.ready ? "ready" : result.eligible ? "mediaBlocked" : "ineligible";

  return (
    <div className={styles.checkerResults} aria-live="polite">
      <section className={styles.checkerCharacter} data-status={status}>
        <div className={styles.checkerAvatar} aria-hidden="true">
          {result.character.avatarUrl ? (
            <img src={result.character.avatarUrl} alt="" />
          ) : (
            <span style={{ color: CCG_CLASS_COLORS[result.character.classID] ?? "#eef5ff" }}>
              {result.character.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className={styles.checkerCharacterIdentity}>
          <span className={styles.checkerStatus}>
            {result.ready ? <FaCircleCheck /> : result.eligible ? <FaImage /> : <FaCircleXmark />}
            {t(`status.${status}`)}
          </span>
          <h2 style={{ color: CCG_CLASS_COLORS[result.character.classID] ?? "#f8fbff" }}>
            {result.character.name}
            <small>-{formatRealmName(result.character.realm)}</small>
          </h2>
          {result.character.guildName ? <p>{result.character.guildName}</p> : null}
        </div>
        <div className={styles.checkerSummaryCount}>
          <strong>{result.raids.filter((raid) => raid.eligible).length}</strong>
          <span>{t("eligibleRaids")}</span>
        </div>
      </section>

      {!result.media.ready ? (
        <aside className={styles.checkerMediaWarning}>
          <FaTriangleExclamation aria-hidden="true" />
          <div>
            <strong>{t(`media.${result.media.status}.title`)}</strong>
            <p>{t(`media.${result.media.status}.body`)}</p>
          </div>
        </aside>
      ) : null}

      <section className={styles.checkerSection} aria-labelledby="checker-cards-title">
        <div className={styles.checkerSectionHeading}>
          <div>
            <span className={styles.eyebrow}>{t("cards.eyebrow")}</span>
            <h2 id="checker-cards-title">{t("cards.title")}</h2>
          </div>
          <span className={styles.checkerSectionCount}>{result.cards.length}</span>
        </div>
        {result.cards.length > 0 ? (
          <ul className={styles.checkerCardList}>
            {result.cards.map((card) => (
              <li key={card.id}>
                <span className={styles.checkerCardGrade} style={{ color: CCG_RARITY_COLORS[card.tierGrade] }}>
                  {card.tierGrade}
                </span>
                <span>
                  <strong>{card.raidName}</strong>
                  <small>
                    {card.kind === "community"
                      ? t("cards.community")
                      : t(`states.${card.state}`)}
                    {card.snapshotCount > 1 ? ` · ${t("cards.snapshots", { count: card.snapshotCount })}` : ""}
                  </small>
                </span>
                <Link href={`/ccg/collection?set=${encodeURIComponent(card.setSlug)}&character=${encodeURIComponent(card.characterId)}`}>
                  <span>{t("cards.view")}</span>
                  <FaArrowUpRightFromSquare aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.checkerSectionEmpty}>
            <FaLayerGroup aria-hidden="true" />
            <p>{t("cards.empty")}</p>
          </div>
        )}
      </section>

      <section className={styles.checkerSection} aria-labelledby="checker-raids-title">
        <div className={styles.checkerSectionHeading}>
          <div>
            <span className={styles.eyebrow}>{t("raids.eyebrow")}</span>
            <h2 id="checker-raids-title">{t("raids.title")}</h2>
            <p>{t("raids.body")}</p>
          </div>
        </div>
        {result.raids.length > 0 ? (
          <div className={styles.checkerRaidList}>
            {result.raids.map((raid) => (
              <article key={raid.zoneId} className={styles.checkerRaid} data-eligible={raid.eligible}>
                <header>
                  <div>
                    <span>{t(`states.${raid.state}`)}</span>
                    <h3>{raid.raidName}</h3>
                  </div>
                  <strong>
                    {raid.ready ? <FaCircleCheck /> : <FaCircleXmark />}
                    {t(raid.ready ? "raids.ready" : raid.eligible ? "raids.waitingForMedia" : "raids.notEligible")}
                  </strong>
                </header>
                <div className={styles.checkerMetrics}>
                  <span data-pass={raid.mythicReports >= result.thresholds.mythicReports}>
                    <small>{t("metrics.mythicReports")}</small>
                    <strong>{raid.mythicReports} / {result.thresholds.mythicReports}</strong>
                  </span>
                  <span data-pass={raid.pulls >= result.thresholds.pulls}>
                    <small>{t("metrics.mythicPulls")}</small>
                    <strong>{raid.pulls} / {result.thresholds.pulls}</strong>
                  </span>
                  <span data-pass={raid.scoresReady}>
                    <small>{t("metrics.scores")}</small>
                    <strong>{t(raid.scoresReady ? "metrics.ready" : "metrics.missing")}</strong>
                  </span>
                </div>
                {raid.blockers.length > 0 ? (
                  <ul className={styles.checkerBlockers}>
                    {raid.blockers.map((blocker) => (
                      <li key={blocker}>
                        <FaCircleXmark aria-hidden="true" />
                        {blocker === "mythic_reports"
                          ? t("blockers.mythicReports", { current: raid.mythicReports, minimum: result.thresholds.mythicReports })
                          : blocker === "mythic_pulls"
                            ? t("blockers.mythicPulls", { current: raid.pulls, minimum: result.thresholds.pulls })
                            : blocker === "scores"
                              ? t("blockers.scores")
                              : t(`blockers.media.${result.media.status}`)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.checkerPassed}>
                    <FaCircleCheck aria-hidden="true" />
                    {t("raids.allRequirementsMet")}
                  </p>
                )}
                {raid.publicationEstimate ? (
                  <aside className={styles.checkerPrediction}>
                    <FaCalendarDay aria-hidden="true" />
                    <div>
                      <strong>{t("prediction.title")}</strong>
                      <p>
                        {t("prediction.body", {
                          snapshotTime: raid.publicationEstimate.snapshotTime,
                          publicationTime: raid.publicationEstimate.publicationTime,
                          timeZone: raid.publicationEstimate.timeZone,
                        })}
                      </p>
                    </div>
                  </aside>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.checkerSectionEmpty}>
            <FaMagnifyingGlass aria-hidden="true" />
            <div>
              <strong>{t("raids.emptyTitle")}</strong>
              <p>{t("raids.emptyBody")}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function CharacterCheckerPage() {
  const t = useTranslations("ccg.characterChecker");
  const [name, setName] = useState("");
  const [realm, setRealm] = useState("");
  const [submitted, setSubmitted] = useState<{ name: string; realm: string } | null>(null);
  const characterQuery = useCcgCharacterCheck(
    submitted?.name ?? "",
    submitted?.realm ?? "",
    Boolean(submitted),
  );
  const canSubmit = name.trim().length >= 2 && realm.trim().length >= 2;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitted({ name: name.trim(), realm: realm.trim() });
  };

  return (
    <CcgShell>
      <div className={styles.checkerPage}>
        <header className={styles.activityHeader}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </header>

        <form className={styles.checkerForm} onSubmit={submit}>
          <label>
            <span>{t("form.name")}</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("form.namePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              maxLength={50}
            />
          </label>
          <label>
            <span>{t("form.realm")}</span>
            <input
              type="text"
              value={realm}
              onChange={(event) => setRealm(event.target.value)}
              placeholder={t("form.realmPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              maxLength={80}
            />
          </label>
          <button type="submit" className={styles.primaryButton} disabled={!canSubmit || characterQuery.isFetching}>
            <FaMagnifyingGlass aria-hidden="true" />
            {characterQuery.isFetching ? t("form.checking") : t("form.submit")}
          </button>
        </form>

        {!submitted ? (
          <section className={styles.checkerIntro}>
            <h2>{t("intro.title")}</h2>
            <p>{t("intro.body")}</p>
            <ul>
              <li><FaCircleCheck aria-hidden="true" />{t("intro.reports")}</li>
              <li><FaCircleCheck aria-hidden="true" />{t("intro.pulls")}</li>
              <li><FaCircleCheck aria-hidden="true" />{t("intro.scores")}</li>
              <li><FaImage aria-hidden="true" />{t("intro.media")}</li>
            </ul>
          </section>
        ) : characterQuery.isPending ? (
          <div className={styles.checkerLoading} aria-label={t("loading")}>
            <span />
            <span />
            <span />
          </div>
        ) : characterQuery.isError ? (
          <div className={styles.checkerError}>
            <CcgLoadError onRetry={() => { void characterQuery.refetch(); }} />
          </div>
        ) : !characterQuery.data.found ? (
          <section className={styles.checkerNotFound} aria-live="polite">
            <FaMagnifyingGlass aria-hidden="true" />
            <h2>{t("notFound.title")}</h2>
            <p>{t("notFound.body", {
              name: characterQuery.data.query.name,
              realm: formatRealmName(characterQuery.data.query.realm),
            })}</p>
          </section>
        ) : (
          <CharacterResult result={characterQuery.data} />
        )}
      </div>
    </CcgShell>
  );
}

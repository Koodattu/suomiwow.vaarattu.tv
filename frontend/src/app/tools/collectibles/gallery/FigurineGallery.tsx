"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import catalog from "@/data/figurines/community-001.json";
import styles from "../../figurine-lab/figurine-lab.module.css";

const FigurineStage = dynamic(() => import("../../figurine-lab/FigurineStage"), { ssr: false });
type Figure = (typeof catalog.characters)[number];

function Preview({ figure }: { figure: Figure }) {
  const t = useTranslations("figurineLab");
  const [files, setFiles] = useState<File[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { setFailed(true); controller.abort(); }, 30_000);
    void (async () => {
      try {
        const response = await fetch(figure.model, { signal: controller.signal });
        if (!response.ok) throw new Error("Model unavailable");
        const blob = await response.blob();
        if (blob.size !== figure.bytes) throw new Error("Incomplete model");
        if (!controller.signal.aborted) setFiles([new File([blob], `${figure.id}.glb`)]);
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [figure, attempt]);
  if (failed) return <div className={styles.galleryPlaceholder}><p>{t("drawError")}</p><button onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>{t("galleryRetry")}</button></div>;
  if (!files.length) return <div className={styles.galleryPlaceholder} role="status">{t("modelLoading")}</div>;
  return <FigurineStage gallery files={files} boxMode={false} open={false} rotate={false}
    labels={{ loading: t("modelLoading"), ready: t("modelReady"), empty: t("modelEmpty"), error: t("modelError"), webgl: t("webglError"), box: t("boxStatus"), boxTitle: t("boxTitle"), boxSubtitle: t("boxSubtitle") }} />;
}

export default function FigurineGallery() {
  const t = useTranslations("figurineLab");
  const grid = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<string[]>([]);
  useEffect(() => {
    const candidates = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.figure!;
        if (entry.isIntersecting) candidates.set(id, entry.intersectionRatio);
        else candidates.delete(id);
      }
      // Keep a bounded number of GPU contexts even on very large displays.
      const next = [...candidates].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
      setVisible((previous) => previous.join() === next.join() ? previous : next);
    }, { rootMargin: "80px", threshold: [0, 0.25, 0.5, 1] });
    grid.current?.querySelectorAll("[data-figure]").forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);
  return <main className={styles.gallery}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{t("localOnly")}</p><h1>{t("galleryTitle")}</h1><p className={styles.intro}>{t("galleryIntro", { count: catalog.characters.length })}</p></div><Link href="/tools/collectibles">{t("openBox")}</Link></header>
    <div ref={grid} className={styles.galleryGrid}>
      {catalog.characters.map((figure) => <article key={figure.id} data-figure={figure.id} className={styles.galleryCard}>
        {visible.includes(figure.id) ? <Preview key={figure.sha256} figure={figure} /> : <div className={styles.galleryPlaceholder}>{t("galleryScroll")}</div>}
        <div className={styles.galleryCaption}><h2>{figure.name}</h2><p>{figure.realm} · {t(`races.${figure.raceKey}`)} · {t(`classes.${figure.classKey}`)}</p><p>{figure.pose.name} · {figure.pose.timeMs} ms · {t(figure.weapons === "held" ? "weaponsHeld" : "weaponsSheathed")}</p><p>{t("collectibleSize", { size: (figure.bytes / 1_000_000).toFixed(2) })}</p></div>
      </article>)}
    </div>
  </main>;
}

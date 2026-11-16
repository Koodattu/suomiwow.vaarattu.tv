"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useTranslations } from "next-intl";
import ForeverNav, { type ForeverSection } from "./ForeverNav";
import { CharacterForm } from "./ForeverShared";
import world from "./forever.module.css";
import styles from "./header.module.css";

export default function ForeverHeader({ title, current }: { title: string; current?: ForeverSection }) {
  const t = useTranslations("forever");
  const [suggesting, setSuggesting] = useState(false);
  return <>
    <header className={styles.header}>
      <div className={styles.heading}>
        <Link href="/forever" className={`${world.wordmark} ${styles.wordmark}`} aria-label={t("brand")}><small>SuomiWoW</small><strong>Forever</strong></Link>
        <h1 className={`${world.title} ${styles.title}`}>{title}</h1>
      </div>
      <ForeverNav current={current} />
      <div className={styles.action}>
        <div className={styles.desktopForm}><CharacterForm compact /></div>
        <button className={styles.suggest} onClick={() => setSuggesting(true)} aria-haspopup="dialog">{t("suggest")}</button>
      </div>
    </header>
    <Dialog open={suggesting} onClose={setSuggesting} className={world.progressDialog}>
      <DialogBackdrop className={world.progressBackdrop} />
      <div className={world.progressDialogPosition}><DialogPanel className={`${world.progressDialogPanel} ${styles.dialog}`}>
        <div className={world.progressDialogHeading}>
          <DialogTitle>{t("suggest")}</DialogTitle>
          <button className={world.button} onClick={() => setSuggesting(false)} aria-label={t("close")}>× {t("close")}</button>
        </div>
        <div className={styles.form}><CharacterForm compact /></div>
      </DialogPanel></div>
    </Dialog>
  </>;
}

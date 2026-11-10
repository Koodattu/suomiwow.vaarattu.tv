"use client";

import { useState, type Dispatch } from "react";
import { useTranslations } from "next-intl";
import { LuCheck, LuGift, LuSend } from "react-icons/lu";
import { findFigure } from "@/lib/figurine-series";
import { PREVIEW_FIGURES, PREVIEW_GIFTS, type PreviewAction, type PreviewState } from "@/lib/figurine-community-preview";
import { playFigurineCue } from "@/lib/figurine-audio";
import { Action, useToast } from "./FacilityParts";
import Portrait from "./Portrait";
import frame from "./facility-overlay.module.css";
import styles from "./trade.module.css";

// The gifting post: parcels waiting on the left, the writing desk on the right, both open at once.
export default function Mailbox({ preview, dispatch }: { preview: PreviewState; dispatch: Dispatch<PreviewAction> }) {
  const t = useTranslations("figurineLab.world.overlays.gifts"), common = useTranslations("figurineLab.world.mail"), quality = useTranslations("figurineLab.quality");
  const [recipient, setRecipient] = useState(""), [message, setMessage] = useState(""), [figure, setFigure] = useState(0), [toast, notify] = useToast();
  const send = () => {
    if (!recipient.trim() || !preview.inventory[figure]) { playFigurineCue("deny"); return; }
    dispatch({ type: "send", recipient, figure, message }); playFigurineCue("paper"); playFigurineCue("swish"); notify(t("sentNotice", { name: recipient.trim() })); setRecipient(""); setMessage("");
  };
  return <div className={styles.post}>
    <section className={`${styles.inbox} ${frame.scroll}`}>
      <h3>{t("inbox")}</h3>
      <div className={styles.parcels}>{PREVIEW_GIFTS.map(gift => {
        const opened = preview.claimed.includes(gift.id), item = PREVIEW_FIGURES[gift.figure];
        return <article key={gift.id} className={styles.parcel} data-open={opened} data-quality={opened ? item.quality : undefined}>
          <div className={styles.parcelPicture}>{opened ? <Portrait figureKey={item.key} quality={item.quality} /> : <span className={styles.wrapped}><LuGift aria-hidden="true" /></span>}</div>
          <div className={styles.parcelText}>
            <small>{t("from", { name: gift.collector })}</small>
            {opened ? <b>{findFigure(item.key)?.character.name}{item.quality !== "standard" && <em> · {quality(item.quality)}</em>}</b> : <p>“{t(`notes.${gift.note}`)}”</p>}
            {opened ? <span className={frame.stamp}><LuCheck />{t("claimed")}</span> : <Action onClick={() => { dispatch({ type: "claim", id: gift.id }); playFigurineCue("gift"); }}><LuGift />{t("claim")}</Action>}
          </div>
        </article>;
      })}</div>
      {!!preview.sent.length && <><h3>{t("sent")}</h3><ul className={styles.sentList}>{preview.sent.map(gift => <li key={gift.id}><span><Portrait figureKey={PREVIEW_FIGURES[gift.figure].key} quality={PREVIEW_FIGURES[gift.figure].quality} /></span><div><b>{t("to", { name: gift.recipient })}</b>{gift.message && <small>“{gift.message}”</small>}</div><LuCheck aria-hidden="true" /></li>)}</ul></>}
    </section>
    <form className={styles.desk} onSubmit={event => { event.preventDefault(); send(); }}>
      <h3>{t("send")}</h3>
      <div className={styles.giftPicker} role="radiogroup" aria-label={common("figure")}>{PREVIEW_FIGURES.map((item, index) => <button key={index} type="button" role="radio" aria-checked={figure === index} data-quality={item.quality} disabled={!preview.inventory[index]} onClick={() => { playFigurineCue("place"); setFigure(index); }} title={findFigure(item.key)?.character.name}>
        <Portrait figureKey={item.key} quality={item.quality} /><span className={frame.copies}>×{preview.inventory[index]}</span>
      </button>)}</div>
      <label>{common("recipient")}<input required maxLength={40} value={recipient} onChange={event => setRecipient(event.target.value)} placeholder={t("recipientPlaceholder")} autoComplete="off" /></label>
      <label className={styles.letter}>{common("message")}<textarea maxLength={240} value={message} onChange={event => setMessage(event.target.value)} placeholder={common("messagePlaceholder")} /></label>
      <Action type="submit" disabled={!recipient.trim() || !preview.inventory[figure]}><LuSend />{t("sendAction")}</Action>
    </form>
    {toast}
  </div>;
}

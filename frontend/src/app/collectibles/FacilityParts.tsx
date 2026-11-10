"use client";

import { createContext, useContext, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import coinImage from "../../../public/figurines/world/coin.webp";
import styles from "./facility-overlay.module.css";

// Controls a facility adds to the panel's header, beside its title.
export const HeaderSlot = createContext<HTMLElement | null>(null);
export function HeaderExtra({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlot);
  return slot ? createPortal(children, slot) : null;
}

export function Coin({ size = 18 }: { size?: number }) {
  return <Image className={styles.coin} src={coinImage} width={48} height={48} alt="" style={{ width: size, height: size }} />;
}
export function Coins({ count, size }: { count: number; size?: number }) {
  return <span className={styles.coins}><Coin size={size} /><b>{count}</b></span>;
}
export function Action({ children, onClick, disabled = false, secondary = false, type = "button" }: { children: ReactNode; onClick?: (event: MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; secondary?: boolean; type?: "button" | "submit" }) {
  return <button type={type} className={secondary ? styles.secondary : styles.primary} disabled={disabled} onClick={onClick}>{children}</button>;
}
// One choice of a few, always the same size, so picking one moves nothing around it.
export function Chips<T extends string>({ values, value, onChange, label, count }: { values: readonly T[]; value: T; onChange: (value: T) => void; label: (value: T) => string; count?: (value: T) => number }) {
  return <div className={styles.chips}>{values.map(item => <button key={item} type="button" aria-pressed={item === value} onClick={() => onChange(item)}>{label(item)}{count && <small>{count(item)}</small>}</button>)}</div>;
}
export function Empty({ icon, text }: { icon: ReactNode; text: string }) { return <div className={styles.empty}>{icon}<p>{text}</p></div>; }

// A passing message over the panel's foot: it takes no room, so nothing shifts when it comes and goes.
export function useToast() {
  const [toast, setToast] = useState({ id: 0, text: "" }), next = useRef(0);
  const element = <div className={styles.toasts} role="status">{toast.text && <span key={toast.id}>{toast.text}</span>}</div>;
  return [element, (text: string) => setToast({ id: ++next.current, text })] as const;
}

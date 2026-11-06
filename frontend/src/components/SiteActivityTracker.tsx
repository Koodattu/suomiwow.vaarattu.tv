"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export default function SiteActivityTracker() {
  const pathname = usePathname();
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
    if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/ccg/overlay" || pathname.startsWith("/api/")) {
      lastPage.current = null;
      return;
    }
    let stopped = false;
    let lastInteraction = Date.now();
    const send = (kind: "pageview" | "activity") => {
      const body = JSON.stringify({ path: pathname, kind, eventId: crypto.randomUUID(), automated: navigator.webdriver });
      const submit = () => fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/telemetry/activity`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body, keepalive: true,
      });
      // Retry the same event ID once; the server deduplicates it. No cookies or
      // persistent browser identifiers are created for audience measurement.
      void submit().then(response => response.status >= 500, () => true).then(retry => {
        if (retry && !stopped) void submit().catch(() => {});
      });
    };
    const pageView = () => {
      if (document.visibilityState !== "visible" || lastPage.current === pathname) return;
      lastPage.current = pathname;
      send("pageview");
    };
    const interact = () => { lastInteraction = Date.now(); };
    const visible = () => { if (document.visibilityState === "visible") { interact(); pageView(); } };
    pageView();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastInteraction < 5 * 60000) send("activity");
    }, 60000);
    document.addEventListener("visibilitychange", visible);
    for (const event of ["pointerdown", "keydown", "scroll"]) window.addEventListener(event, interact, { passive: true });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      for (const event of ["pointerdown", "keydown", "scroll"]) window.removeEventListener(event, interact);
    };
  }, [pathname]);
  return null;
}

"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { usePathname } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { useEffect, useState, useMemo } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { QueryProvider } from "@/lib/query-provider";
import { getLocale, LOCALE_CHANGE_EVENT, type Locale } from "@/lib/locale";
import {
  buildWebSiteStructuredData,
  getCanonicalUrl,
  getPageEmbedImageAlt,
  getPageEmbedImageUrl,
  getPageEmbedImageSize,
  getPageMetadata,
  getPageTwitterCard,
  SEO_KEYWORDS,
  SITE_IMAGE_ALT,
  SITE_NAME,
} from "@/lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const WEBSITE_STRUCTURED_DATA = buildWebSiteStructuredData();
const KEYWORDS = SEO_KEYWORDS.join(", ");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const isLivestreamsPage = pathname === "/livestreams";
  const isNetworkAnalyticsPage = pathname === "/analytics/network";
  const isCcgPage = pathname.startsWith("/fun/ccg");
  const isCcgSharePage = pathname.startsWith("/fun/ccg/share/");
  const isCcgOverlayPage = pathname === "/fun/ccg/overlay";
  const isHomePage = pathname === "/";
  const robotsContent =
    pathname.startsWith("/admin") || pathname.startsWith("/profile") || isCcgOverlayPage
      ? "noindex, nofollow"
      : "index, follow";
  const [locale, setLocale] = useState<Locale>("en");
  const [messages, setMessages] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let active = true;
    let loadId = 0;

    const loadLocale = (nextLocale: Locale) => {
      const currentLoadId = ++loadId;
      document.documentElement.lang = nextLocale;

      import(`../../messages/${nextLocale}.json`).then((m) => {
        if (!active || currentLoadId !== loadId) return;
        setLocale(nextLocale);
        setMessages(m.default);
      });
    };

    const handleLocaleChange = (event: Event) => {
      loadLocale((event as CustomEvent<Locale>).detail);
    };

    loadLocale(getLocale());
    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);

    return () => {
      active = false;
      window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    };
  }, []);

  const pageMetadata = useMemo(() => getPageMetadata(pathname, locale), [pathname, locale]);
  const fullTitle = `${pageMetadata.title} | ${SITE_NAME}`;
  const canonicalUrl = getCanonicalUrl(pathname);
  const embedImage = getPageEmbedImageUrl(pageMetadata);
  const embedImageSize = getPageEmbedImageSize(pageMetadata);
  const embedImageAlt = getPageEmbedImageAlt(pageMetadata) || SITE_IMAGE_ALT;
  const twitterCard = getPageTwitterCard();

  if (!messages) {
    return (
      <html lang={locale}>
        <head>
          {!isCcgSharePage && (
            <>
              <title>{fullTitle}</title>
              <meta name="title" content={fullTitle} />
              <meta name="description" content={pageMetadata.description} />
              <meta name="robots" content={robotsContent} />
              <link rel="canonical" href={canonicalUrl} />
              <meta property="og:type" content="website" />
              <meta property="og:url" content={canonicalUrl} />
              <meta property="og:title" content={fullTitle} />
              <meta property="og:description" content={pageMetadata.description} />
              <meta property="og:image" content={embedImage} />
              <meta property="og:image:secure_url" content={embedImage} />
              <meta property="og:image:type" content="image/png" />
              <meta property="og:image:width" content={String(embedImageSize.width)} />
              <meta property="og:image:height" content={String(embedImageSize.height)} />
              <meta property="og:image:alt" content={embedImageAlt} />
              <meta property="og:site_name" content={SITE_NAME} />
              <meta property="og:locale" content="en_US" />
              <meta name="twitter:card" content={twitterCard} />
              <meta name="twitter:url" content={canonicalUrl} />
              <meta name="twitter:title" content={fullTitle} />
              <meta name="twitter:description" content={pageMetadata.description} />
              <meta name="twitter:image" content={embedImage} />
              <meta name="twitter:image:alt" content={embedImageAlt} />
            </>
          )}
          <meta name="application-name" content={SITE_NAME} />
          <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
          <meta name="keywords" content={KEYWORDS} />
          <link rel="icon" href="/suomiwow-share.png" type="image/png" sizes="512x512" />
          {isHomePage && (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify(WEBSITE_STRUCTURED_DATA),
              }}
            />
          )}
        </head>
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased ${isCcgOverlayPage ? "ccg-overlay-body" : ""}`}>
          {!isCcgOverlayPage && <div className="flex items-center justify-center min-h-screen"><div className="text-white">Loading...</div></div>}
        </body>
      </html>
    );
  }

  return (
    <html lang={locale}>
      <head>
        {/* Primary Meta Tags */}
        {!isCcgSharePage && (
          <>
            <title>{fullTitle}</title>
            <meta name="title" content={fullTitle} />
            <meta name="description" content={pageMetadata.description} />
            <meta name="robots" content={robotsContent} />
            <link rel="canonical" href={canonicalUrl} />
            <meta property="og:type" content="website" />
            <meta property="og:url" content={canonicalUrl} />
            <meta property="og:title" content={fullTitle} />
            <meta property="og:description" content={pageMetadata.description} />
            <meta property="og:image" content={embedImage} />
            <meta property="og:image:secure_url" content={embedImage} />
            <meta property="og:image:type" content="image/png" />
            <meta property="og:image:width" content={String(embedImageSize.width)} />
            <meta property="og:image:height" content={String(embedImageSize.height)} />
            <meta property="og:image:alt" content={embedImageAlt} />
            <meta property="og:site_name" content={SITE_NAME} />
            <meta property="og:locale" content={locale === "fi" ? "fi_FI" : "en_US"} />
            <meta name="twitter:card" content={twitterCard} />
            <meta name="twitter:url" content={canonicalUrl} />
            <meta name="twitter:title" content={fullTitle} />
            <meta name="twitter:description" content={pageMetadata.description} />
            <meta name="twitter:image" content={embedImage} />
            <meta name="twitter:image:alt" content={embedImageAlt} />
          </>
        )}
        <meta name="application-name" content={SITE_NAME} />
        <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
        <meta name="keywords" content={KEYWORDS} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1a1a2e" />

        {/* Favicon */}
        <link rel="icon" href="/suomiwow-share.png" type="image/png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/suomiwow-share.png" />

        {isHomePage && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(WEBSITE_STRUCTURED_DATA),
            }}
          />
        )}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased ${isCcgOverlayPage ? "ccg-overlay-body" : ""}`}>
        <QueryProvider>
          <AuthProvider>
            <NextIntlClientProvider locale={locale} messages={messages}>
              {!isCcgPage && <Navigation />}
              {children}
              {!isLivestreamsPage && !isNetworkAnalyticsPage && !isCcgPage && <Footer />}
            </NextIntlClientProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

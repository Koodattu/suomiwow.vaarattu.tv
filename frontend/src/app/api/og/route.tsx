import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import {
  EMBED_IMAGE_HEIGHT,
  EMBED_IMAGE_WIDTH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";

export const runtime = "edge";

const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");

function cleanParam(value: string | null, fallback: string, maxLength: number) {
  const normalized = (value || fallback).replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trim()}...`
    : normalized;
}

function getTitleFontSize(title: string) {
  if (title.length > 58) return 38;
  if (title.length > 42) return 44;
  if (title.length > 28) return 52;
  return 60;
}

function getPalette(label: string) {
  const normalized = label.toLowerCase();

  if (normalized.includes("character")) {
    return {
      primary: "#22c55e",
      secondary: "#38bdf8",
      tertiary: "#f59e0b",
      surface: "#0e1512",
    };
  }

  if (normalized.includes("analytics") || normalized.includes("comparison") || normalized.includes("network")) {
    return {
      primary: "#38bdf8",
      secondary: "#f59e0b",
      tertiary: "#ef4444",
      surface: "#0d1218",
    };
  }

  if (normalized.includes("event") || normalized.includes("livestream")) {
    return {
      primary: "#ef4444",
      secondary: "#f59e0b",
      tertiary: "#22c55e",
      surface: "#160f10",
    };
  }

  return {
    primary: "#f59e0b",
    secondary: "#22c55e",
    tertiary: "#38bdf8",
    surface: "#11110d",
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const title = cleanParam(searchParams.get("title"), SITE_NAME, 76);
  const description = cleanParam(searchParams.get("description"), SITE_DESCRIPTION, 132);
  const label = cleanParam(searchParams.get("label"), "Finnish WoW", 28);
  const palette = getPalette(label);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: palette.surface,
          color: "#f8fafc",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ width: "100%", height: 10, display: "flex" }}>
          <div style={{ width: "42%", height: "100%", background: palette.primary }} />
          <div style={{ width: "35%", height: "100%", background: palette.secondary }} />
          <div style={{ flex: 1, height: "100%", background: palette.tertiary }} />
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "34px 36px 30px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  background: palette.primary,
                  color: "#111827",
                  fontSize: 21,
                  fontWeight: 800,
                }}
              >
                SW
              </div>
              <div style={{ display: "flex", flexDirection: "column", marginLeft: 12 }}>
                <div style={{ fontSize: 23, fontWeight: 800 }}>{SITE_NAME}</div>
                <div style={{ marginTop: 2, fontSize: 16, color: "#cbd5e1" }}>Finnish WoW progress</div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                padding: "7px 10px",
                border: "1px solid rgba(248, 250, 252, 0.24)",
                borderRadius: 7,
                color: "#f8fafc",
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {label}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 42,
            }}
          >
            <div
              style={{
                color: "#ffffff",
                fontSize: getTitleFontSize(title),
                fontWeight: 800,
                lineHeight: 1.06,
              }}
            >
              {title}
            </div>
            <div
              style={{
                marginTop: 18,
                color: "#cbd5e1",
                fontSize: 23,
                lineHeight: 1.24,
              }}
            >
              {description}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: "auto",
              paddingTop: 20,
              borderTop: "1px solid rgba(248, 250, 252, 0.18)",
              color: "#94a3b8",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            <div>{SITE_HOST}</div>
            <div style={{ color: palette.primary }}>Progress - Logs - Streams</div>
          </div>
        </div>
      </div>
    ),
    {
      width: EMBED_IMAGE_WIDTH,
      height: EMBED_IMAGE_HEIGHT,
    },
  );
}

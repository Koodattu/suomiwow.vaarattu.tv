import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import {
  CCG_OG_IMAGE_RESPONSE_OPTIONS,
  renderCcgMainOg,
} from "@/lib/ccg-og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanParam(value: string | null, fallback: string, maxLength: number) {
  const normalized = (value || fallback).replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trim()}…`
    : normalized;
}

function getView(value: string | null): "vault" | "open" | "collection" {
  if (value === "open" || value === "collection") return value;
  return "vault";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const title = cleanParam(params.get("title"), "SuomiWoW CCG", 82);
  const description = cleanParam(params.get("description"), "Open free character card packs and build your collection.", 180);
  const cta = cleanParam(params.get("cta"), "Open free packs", 42);
  const view = getView(params.get("view"));

  return new ImageResponse(
    await renderCcgMainOg({ title, description, cta, view }),
    CCG_OG_IMAGE_RESPONSE_OPTIONS,
  );
}

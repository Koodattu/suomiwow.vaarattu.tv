import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import {
  CCG_OG_IMAGE_RESPONSE_OPTIONS,
  renderCcgShareOg,
} from "@/lib/ccg-og";
import { fetchCcgShare, resolveCcgEmbedLocale } from "@/lib/ccg-share-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ kind: string; shareId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { kind, shareId } = await params;
  if (kind !== "card" && kind !== "pack") {
    return new Response("Share image not found", { status: 404 });
  }

  const share = await fetchCcgShare(shareId);
  if (!share || share.kind !== kind) {
    return new Response("Share image not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const locale = resolveCcgEmbedLocale(request.nextUrl.searchParams.get("lang") ?? undefined);
  return new ImageResponse(
    await renderCcgShareOg(share, locale),
    CCG_OG_IMAGE_RESPONSE_OPTIONS,
  );
}

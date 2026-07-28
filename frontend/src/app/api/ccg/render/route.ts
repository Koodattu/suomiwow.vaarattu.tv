import type { NextRequest } from "next/server";

const ALLOWED_HOST = "render.worldofwarcraft.com";
const MAX_RENDER_BYTES = 8 * 1024 * 1024;
const RENDER_CACHE_SECONDS = 7 * 24 * 60 * 60;

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");

  if (!rawUrl || rawUrl.length > 2048) {
    return new Response("Invalid render URL", { status: 400 });
  }

  let renderUrl: URL;
  try {
    renderUrl = new URL(rawUrl);
  } catch {
    return new Response("Invalid render URL", { status: 400 });
  }

  if (renderUrl.protocol !== "https:" || renderUrl.hostname !== ALLOWED_HOST) {
    return new Response("Render host is not allowed", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(renderUrl, {
      redirect: "error",
      next: { revalidate: RENDER_CACHE_SECONDS },
    });
  } catch {
    return new Response("Render unavailable", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Render unavailable", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const contentLength = Number(upstream.headers.get("content-length") ?? 0);
  if (!contentType.startsWith("image/") || contentLength > MAX_RENDER_BYTES) {
    return new Response("Invalid render response", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Cache-Control": `public, max-age=${RENDER_CACHE_SECONDS}, must-revalidate`,
      "Content-Type": contentType,
    },
  });
}

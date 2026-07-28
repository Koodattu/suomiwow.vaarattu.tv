const CHARACTER_RENDER_MAX_WIDTH = 3840;
const CHARACTER_RENDER_QUALITY = 95;

export function getCharacterRenderProxyUrl(renderUrl: string): string {
  if (renderUrl.startsWith("/ccg/alternative/character/")) return renderUrl;
  return `/api/ccg/render?url=${encodeURIComponent(renderUrl)}`;
}

export function getCharacterRenderImageUrl(renderUrl: string): string {
  const sourceUrl = getCharacterRenderProxyUrl(renderUrl);
  if (process.env.NODE_ENV !== "production" || /\.gif(?:$|[?#])/i.test(sourceUrl)) return sourceUrl;

  const params = new URLSearchParams({
    url: sourceUrl,
    w: String(CHARACTER_RENDER_MAX_WIDTH),
    q: String(CHARACTER_RENDER_QUALITY),
  });
  return `/_next/image?${params.toString()}`;
}

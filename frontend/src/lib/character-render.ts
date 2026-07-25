export function getCharacterRenderProxyUrl(renderUrl: string): string {
  if (renderUrl.startsWith("/ccg/alternative/character/")) return renderUrl;
  return `/api/ccg/render?url=${encodeURIComponent(renderUrl)}`;
}

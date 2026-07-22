export function getCharacterRenderProxyUrl(renderUrl: string): string {
  return `/api/ccg/render?url=${encodeURIComponent(renderUrl)}`;
}

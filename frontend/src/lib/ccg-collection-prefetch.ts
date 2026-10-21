import type { QueryClient, FetchQueryOptions } from "@tanstack/react-query";

// One page only: warming its cache must never recursively fetch another page.
export async function prefetchCcgCollectionPage<T>(
  client: QueryClient,
  options: FetchQueryOptions<T>,
  signal: AbortSignal,
  artworkUrls: (data: T) => string[],
  warmImage: (url: string, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  if (signal.aborted) return;
  try {
    // Navigation to this page shares the same in-flight request. Don't abort
    // that request on cleanup; just stop speculative artwork work.
    const data = await client.fetchQuery({ ...options, retry: false });
    if (signal.aborted) return;
    const urls = [...new Set(artworkUrls(data))];
    const worker = async () => {
      while (!signal.aborted && urls.length) {
        const url = urls.shift()!;
        await warmImage(url, signal).catch(() => undefined);
      }
    };
    await Promise.all([worker(), worker()]);
  } catch {
    // A speculative failure must not affect the visible page. Its normal query
    // can retry when the user actually navigates there.
  }
}

export function warmCcgCollectionImage(url: string, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const image = new Image();
    const finish = () => {
      image.onload = image.onerror = null;
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => { image.removeAttribute("src"); finish(); };
    image.fetchPriority = "low";
    image.onload = image.onerror = finish;
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

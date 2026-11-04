/** Decorative images must settle even when a connection stalls rather than failing. */
export function loadFigurineImage(url: string, signal?: AbortSignal, timeoutMs = 8_000): Promise<HTMLImageElement | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      image.onload = image.onerror = null;
      if (!loaded) image.src = "";
      resolve(loaded ? image : null);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(cancel, timeoutMs);
    image.onload = () => finish(true); image.onerror = cancel;
    signal?.addEventListener("abort", cancel, { once: true });
    image.src = url;
  });
}

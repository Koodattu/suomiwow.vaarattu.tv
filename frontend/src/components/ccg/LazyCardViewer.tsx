"use client";

import type { ComponentProps } from "react";

type ViewerModule = typeof import("./CardViewer");
let viewerModule: ViewerModule | undefined;

// Load before capturing the origin so the shared transition includes the viewer.
export async function openCardViewer(...args: Parameters<ViewerModule["openCardViewer"]>) {
  viewerModule ??= await import("./CardViewer");
  viewerModule.openCardViewer(...args);
}

export default function LazyCardViewer(props: ComponentProps<ViewerModule["default"]>) {
  const Viewer = viewerModule?.default;
  return Viewer ? <Viewer {...props} /> : null;
}

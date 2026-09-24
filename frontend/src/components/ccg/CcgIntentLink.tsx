"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

export default function CcgIntentLink({ onMouseEnter, onFocus, ...props }: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [prefetch, setPrefetch] = useState(false);
  return (
    <Link
      {...props}
      prefetch={prefetch ? null : false}
      onMouseEnter={(event) => {
        setPrefetch(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setPrefetch(true);
        onFocus?.(event);
      }}
    />
  );
}

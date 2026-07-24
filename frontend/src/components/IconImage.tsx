"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface IconImageProps {
  iconFilename: string | undefined;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
}

/**
 * Component that loads icons with fallback logic:
 * 1. Try to load from local public/icons directory
 * 2. If not found, try to load from backend API
 * 3. If still not found, show placeholder
 */
export default function IconImage({
  iconFilename,
  alt,
  width,
  height,
  fill = false,
  className = "",
  style,
  onReady,
}: IconImageProps) {
  const [imageState, setImageState] = useState<
    "local" | "backend" | "placeholder"
  >("local");
  const [backendFailed, setBackendFailed] = useState(false);
  const readyIcon = useRef<string | null>(null);

  const notifyReady = () => {
    const readyKey = iconFilename ?? "__missing__";
    if (readyIcon.current === readyKey) return;
    readyIcon.current = readyKey;
    onReady?.();
  };

  useEffect(() => {
    if (!iconFilename || imageState === "placeholder" || backendFailed) notifyReady();
  }, [backendFailed, iconFilename, imageState]);

  if (!iconFilename) {
    return (
      <div
        className={`bg-gray-700 rounded ${className}`}
        style={
          fill
            ? { ...style, position: "absolute", inset: 0 }
            : { width, height, ...style }
        }
      />
    );
  }

  // If it's already a full URL, use it directly
  if (
    iconFilename.startsWith("http://") ||
    iconFilename.startsWith("https://")
  ) {
    return (
      <Image
        src={iconFilename}
        alt={alt}
        width={fill ? undefined : width}
        height={fill ? undefined : height}
        fill={fill}
        className={className}
        style={style}
        onLoad={notifyReady}
        onError={() => setImageState("placeholder")}
      />
    );
  }

  // Show placeholder if both local and backend failed
  if (imageState === "placeholder" || backendFailed) {
    return (
      <div
        className={`bg-gray-700 rounded ${className}`}
        style={{ width, height }}
      />
    );
  }

  // Try local first, then backend
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  const localPath = `/icons/${iconFilename}`;
  const backendPath = `${apiUrl}/icons/${iconFilename}`;

  const currentSrc = imageState === "local" ? localPath : backendPath;

  return (
    <Image
      src={currentSrc}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      fill={fill}
      className={className}
      style={style}
      onLoad={notifyReady}
      onError={() => {
        if (imageState === "local") {
          // Local failed, try backend
          setImageState("backend");
        } else if (imageState === "backend") {
          // Backend also failed, show placeholder
          setBackendFailed(true);
          setImageState("placeholder");
        }
      }}
    />
  );
}

"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import IconImage from "@/components/IconImage";

type CharacterAvatarProps = {
  avatarUrl?: string | null;
  classIcon?: string;
  characterName: string;
  className?: string;
};

export default function CharacterAvatar({ avatarUrl, classIcon, characterName, className = "" }: CharacterAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [avatarUrl]);

  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-md bg-gray-900 ring-1 ring-white/10 ${className}`}>
      {avatarUrl && !failed ? (
        <Image src={avatarUrl} alt={`${characterName} avatar`} fill sizes="64px" className="object-cover" onError={() => setFailed(true)} />
      ) : (
        <IconImage iconFilename={classIcon} alt={characterName} fill style={{ objectFit: "cover" }} />
      )}
    </span>
  );
}

"use client";

import IconImage from "@/components/IconImage";
import { getClassInfoById } from "@/lib/utils";

export function FunClassIcon({ classID, size = 32 }: { classID: number; size?: number }) {
  const classInfo = getClassInfoById(classID);

  return (
    <span
      className="relative block shrink-0 overflow-hidden rounded-md outline outline-1 -outline-offset-1 outline-white/10"
      style={{ width: size, height: size }}
    >
      <IconImage iconFilename={classInfo.iconUrl} alt={`${classInfo.name} icon`} fill style={{ objectFit: "cover" }} />
    </span>
  );
}

export default function FunCharacterIdentity({
  character,
  iconSize = 32,
  showRealm = true,
  className = "",
}: {
  character: { name: string; realm: string; classID: number };
  iconSize?: number;
  showRealm?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 items-center gap-3 ${className}`}>
      <FunClassIcon classID={character.classID} size={iconSize} />
      <span className="min-w-0 text-left">
        <span className="block truncate font-bold">{character.name}</span>
        {showRealm ? <span className="block truncate text-xs text-slate-400">{character.realm}</span> : null}
      </span>
    </span>
  );
}

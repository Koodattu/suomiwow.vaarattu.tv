"use client";

import Image from "next/image";
import IconImage from "@/components/IconImage";
import type { FunRaid } from "@/types";

export function ExpansionIcon({ expansion, className = "" }: { expansion: string; className?: string }) {
  const filename = expansion.toLocaleLowerCase("en-US").replace(/\s+/g, "-");
  return <Image src={`/expansions/${filename}.png`} alt="" width={32} height={20} className={`h-auto shrink-0 object-contain ${className}`} />;
}

export function FunIcon({ iconUrl, label, size = 32 }: { iconUrl: string | null | undefined; label: string; size?: number }) {
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-md outline outline-1 -outline-offset-1 outline-white/10" style={{ width: size, height: size }}>
      <IconImage iconFilename={iconUrl ?? undefined} alt={`${label} icon`} fill style={{ objectFit: "cover" }} />
    </span>
  );
}

export function FunRaidIdentity({ raid, iconSize = 36, compact = false, className = "" }: { raid: FunRaid; iconSize?: number; compact?: boolean; className?: string }) {
  return (
    <span className={`flex min-w-0 items-center ${compact ? "gap-2" : "gap-3"} ${className}`}>
      <FunIcon iconUrl={raid.iconUrl} label={raid.name} size={iconSize} />
      <span className="min-w-0 text-left">
        <span className={`flex items-center gap-2 font-semibold text-slate-400 ${compact ? "text-[10px]" : "text-xs"}`}>
          <ExpansionIcon expansion={raid.expansion} className={compact ? "w-6" : "w-7"} />
          <span className="truncate">{raid.expansion}</span>
        </span>
        <span className="mt-0.5 block truncate font-black">{raid.name}</span>
      </span>
    </span>
  );
}

export function FunBossIdentity({ name, iconUrl, iconSize = 32, detail, className = "" }: { name: string; iconUrl: string | null | undefined; iconSize?: number; detail?: string; className?: string }) {
  return (
    <span className={`flex min-w-0 items-center gap-3 ${className}`}>
      <FunIcon iconUrl={iconUrl} label={name} size={iconSize} />
      <span className="min-w-0 text-left">
        <span className="block truncate font-black">{name}</span>
        {detail ? <span className="mt-0.5 block truncate text-xs font-normal text-slate-400">{detail}</span> : null}
      </span>
    </span>
  );
}

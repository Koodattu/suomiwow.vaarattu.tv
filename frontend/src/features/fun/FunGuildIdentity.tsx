"use client";

import GuildCrest from "@/components/GuildCrest";
import type { FunGuild, GuildCrest as GuildCrestType } from "@/types";

export function FunGuildCrest({
  crest,
  faction,
  size = 40,
}: {
  crest: GuildCrestType | null | undefined;
  faction: string | null | undefined;
  size?: number;
}) {
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute left-0 top-0 block origin-top-left" style={{ transform: `scale(${size / 128})` }}>
        <GuildCrest crest={crest ?? undefined} faction={faction ?? undefined} size={128} drawFactionCircle={false} />
      </span>
    </span>
  );
}

export default function FunGuildIdentity({
  guild,
  crestSize = 40,
  className = "",
  wrapName = false,
}: {
  guild: Pick<FunGuild, "name" | "realm" | "crest" | "faction">;
  crestSize?: number;
  className?: string;
  wrapName?: boolean;
}) {
  return (
    <span className={`flex min-w-0 items-center gap-3 ${className}`}>
      <FunGuildCrest crest={guild.crest} faction={guild.faction} size={crestSize} />
      <span className="min-w-0 text-left">
        <span className={`block font-bold ${wrapName ? "line-clamp-2 leading-tight" : "truncate"}`}>{guild.name}</span>
        <span className="block truncate text-xs text-slate-400">{guild.realm}</span>
      </span>
    </span>
  );
}

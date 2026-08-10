import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import GuildCrest from "@/components/GuildCrest";
import IconImage from "@/components/IconImage";
import type { ReporterPost } from "@/types";

const LINK_PATTERN = /\[\[([A-Z]\d+)\|([^\]\n]{1,80})\]\]/g;

type ResolvedReporterLink = ReporterPost["links"][string];

function InlineLinkVisual({ link }: { link: ResolvedReporterLink }) {
  const visual = link.visual;
  if (visual?.type === "guild-crest" && visual.crest) {
    return (
      <span aria-hidden="true" className="inline-block h-[18px] w-[18px] shrink-0 overflow-hidden">
        <GuildCrest crest={visual.crest} faction={visual.faction} size={128} className="origin-top-left scale-[0.140625]" drawFactionCircle={false} />
      </span>
    );
  }

  if (visual?.type === "icon" && visual.iconUrl) {
    return (
      <span aria-hidden="true" className="relative inline-flex h-[18px] w-[18px] shrink-0 empty:hidden">
        <IconImage
          iconFilename={visual.iconUrl}
          alt=""
          width={18}
          height={18}
          hideOnFailure
          className="h-[18px] w-[18px] rounded-[4px] object-cover outline outline-1 -outline-offset-1 outline-white/10"
        />
        {visual.provider === "wcl" && (
          <span className="absolute -bottom-0.5 -right-0.5 grid h-[10px] w-[10px] place-items-center rounded-full bg-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
            <Image src="/wcl-logo.png" alt="" width={9} height={9} className="h-[9px] w-[9px] object-contain" />
          </span>
        )}
      </span>
    );
  }

  if (visual?.type !== "wcl" && !(!visual && link.kind === "log")) return null;
  return <Image aria-hidden="true" src="/wcl-logo.png" alt="" width={17} height={17} className="h-[17px] w-[17px] shrink-0 object-contain" />;
}

function renderInlineLinks(text: string, links: ReporterPost["links"], paragraphIndex: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(LINK_PATTERN);

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const link = links[match[1]];
    if (!link) {
      nodes.push(match[2]);
    } else if (link.url.startsWith("http://") || link.url.startsWith("https://")) {
      nodes.push(
        <a key={`${paragraphIndex}-${match.index}`} href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 align-[-0.12em] font-medium text-amber-300 underline decoration-amber-500/50 underline-offset-4 transition-colors hover:text-amber-200">
          <InlineLinkVisual link={link} />
          <span>{match[2]}</span>
        </a>,
      );
    } else {
      nodes.push(
        <Link key={`${paragraphIndex}-${match.index}`} href={link.url} className="inline-flex items-center gap-1 align-[-0.12em] font-medium text-amber-300 underline decoration-amber-500/50 underline-offset-4 transition-colors hover:text-amber-200">
          <InlineLinkVisual link={link} />
          <span>{match[2]}</span>
        </Link>,
      );
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function ReporterArticleBody({ body, links }: { body: string; links: ReporterPost["links"] }) {
  return (
    <div className="space-y-5 text-pretty text-base leading-8 text-slate-200 sm:text-lg">
      {body
        .split(/\n\s*\n/u)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={`${index}-${paragraph.slice(0, 24)}`}>{renderInlineLinks(paragraph, links, index)}</p>
        ))}
    </div>
  );
}

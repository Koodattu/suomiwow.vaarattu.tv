import Link from "next/link";
import type { ReactNode } from "react";
import type { ReporterPost } from "@/types";

const LINK_PATTERN = /\[\[([A-Z]\d+)\|([^\]\n]{1,80})\]\]/g;

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
        <a key={`${paragraphIndex}-${match.index}`} href={link.url} target="_blank" rel="noreferrer" className="font-medium text-amber-300 underline decoration-amber-500/50 underline-offset-4 hover:text-amber-200">
          {match[2]}
        </a>,
      );
    } else {
      nodes.push(
        <Link key={`${paragraphIndex}-${match.index}`} href={link.url} className="font-medium text-amber-300 underline decoration-amber-500/50 underline-offset-4 hover:text-amber-200">
          {match[2]}
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

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CcgSharedView from "@/components/ccg/CcgSharedView";
import {
  buildCcgShareMetadata,
  fetchCcgShare,
  resolveCcgEmbedLocale,
  type CcgShareSearchParams,
} from "@/lib/ccg-share-metadata";

type Props = {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<CcgShareSearchParams>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ shareId }, query] = await Promise.all([params, searchParams]);
  return buildCcgShareMetadata({
    shareId,
    expectedKind: "card",
    locale: resolveCcgEmbedLocale(query.lang),
  });
}

export default async function SharedCcgCardPage({ params }: Props) {
  const { shareId } = await params;
  const share = await fetchCcgShare(shareId);
  if (!share || share.kind !== "card") notFound();

  return <CcgSharedView shareId={shareId} expectedKind="card" initialShare={share} />;
}

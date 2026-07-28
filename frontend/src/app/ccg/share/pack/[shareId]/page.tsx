import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  buildCcgShareMetadata,
  fetchCcgShare,
  getCcgSharePath,
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
    locale: resolveCcgEmbedLocale(query.lang),
  });
}

export default async function LegacySharedCcgPackPage({ params, searchParams }: Props) {
  const [{ shareId }, query] = await Promise.all([params, searchParams]);
  const share = await fetchCcgShare(shareId);
  if (!share || share.kind !== "pack") notFound();

  permanentRedirect(getCcgSharePath(share.id, query));
}

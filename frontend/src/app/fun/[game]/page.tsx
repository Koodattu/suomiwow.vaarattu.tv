import { notFound } from "next/navigation";
import FunGamePage from "@/features/fun/FunGamePage";
import { isFunGameSlug } from "@/types";

export default async function PrototypeGameRoute({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  if (!isFunGameSlug(game)) notFound();
  return <FunGamePage game={game} />;
}

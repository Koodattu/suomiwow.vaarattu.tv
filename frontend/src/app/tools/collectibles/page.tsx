import { notFound } from "next/navigation";
import BlindBox from "../figurine-lab/BlindBox";

export default function CollectiblesPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BlindBox immersive />;
}

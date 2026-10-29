import { notFound } from "next/navigation";
import FigurineWorld from "./FigurineWorld";

export default function CollectiblesPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <FigurineWorld />;
}

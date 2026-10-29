import { notFound } from "next/navigation";
import FigurineLab from "./FigurineLab";

export default function FigurineLabPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <FigurineLab />;
}

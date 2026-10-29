import { notFound } from "next/navigation";
import FigurineGallery from "./FigurineGallery";

export default function GalleryPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <FigurineGallery />;
}

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import PrototypeLab from "./PrototypeLab";

function isLocalHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "localhost"
    || normalized.startsWith("localhost:")
    || normalized === "127.0.0.1"
    || normalized.startsWith("127.0.0.1:")
    || normalized === "[::1]"
    || normalized.startsWith("[::1]:");
}

export default async function CcgCardPrototypesPage() {
  const host = (await headers()).get("host") ?? "";

  if (process.env.NODE_ENV !== "development" && !isLocalHost(host)) notFound();

  return <PrototypeLab />;
}

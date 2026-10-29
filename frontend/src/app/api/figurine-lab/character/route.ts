import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { compareAppearance, normalizeCharacterQuery, type CharacterAppearance, type LabCharacter } from "@/lib/figurine-lab";

export const runtime = "nodejs";
let token: { value: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;

class UpstreamError extends Error {
  status: number;
  constructor(status: number) { super("Blizzard request failed"); this.status = status; }
}

async function accessToken() {
  if (token && token.expiresAt > Date.now()) return token.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    // This lab runs without starting the database-backed application server.
    // Read only the existing Blizzard settings; nothing is sent to the browser.
    let local: Record<string, string | undefined> = {};
    if (!process.env.BLIZZARD_CLIENT_ID || !process.env.BLIZZARD_CLIENT_SECRET) {
      try { local = parseEnv(await readFile(resolve(process.cwd(), "../backend/.env"), "utf8")); } catch { /* Report missing configuration below. */ }
    }
    const id = process.env.BLIZZARD_CLIENT_ID || local.BLIZZARD_CLIENT_ID;
    const secret = process.env.BLIZZARD_CLIENT_SECRET || local.BLIZZARD_CLIENT_SECRET;
    if (!id || !secret) throw new UpstreamError(503);
    const response = await fetch("https://oauth.battle.net/token", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new UpstreamError(502);
    const data = await response.json();
    if (typeof data.access_token !== "string" || typeof data.expires_in !== "number") throw new UpstreamError(502);
    token = { value: data.access_token, expiresAt: Date.now() + Math.max(0, data.expires_in - 60) * 1000 };
    return token.value;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  const query = normalizeCharacterQuery(params.get("name") ?? "", params.get("realm") ?? "");
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!query) return Response.json({ error: "invalidInput" }, { status: 400, headers });
  try {
    const bearer = await accessToken();
    const base = `https://eu.api.blizzard.com/profile/wow/character/${query.realm}/${encodeURIComponent(query.name)}`;
    async function get(suffix: string, optional = false) {
      const response = await fetch(`${base}${suffix}?namespace=profile-eu&locale=en_GB`, {
        headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 401) token = null;
      if (optional && (response.status === 404 || response.status === 204)) return null;
      if (!response.ok || response.status === 204) throw new UpstreamError(response.status === 404 || response.status === 204 ? 404 : response.status === 429 ? 429 : 502);
      return response.json();
    }
    const [profile, appearance, equipment, media] = await Promise.all([get(""), get("/appearance"), get("/equipment"), get("/character-media", true)]);
    if (!Array.isArray(appearance.items) || !Array.isArray(appearance.customizations) || !Array.isArray(equipment.equipped_items)) throw new UpstreamError(502);
    const rawRender = media?.assets?.find((asset: { key: string }) => asset.key === "main-raw")?.value;
    let renderUrl: string | null = null;
    if (typeof rawRender === "string") {
      const candidate = new URL(rawRender);
      if (candidate.protocol === "https:" && candidate.hostname === "render.worldofwarcraft.com") renderUrl = candidate.href;
    }
    const result: LabCharacter = {
      name: profile.name, realm: profile.realm.name, race: profile.race.name, characterClass: profile.character_class.name,
      lastLogin: profile.last_login_timestamp ?? null, fetchedAt: new Date().toISOString(), renderUrl,
      appearance: appearance as CharacterAppearance,
      equipment: compareAppearance(appearance.items, equipment.equipped_items),
    };
    return Response.json(result, { headers });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 502;
    const code = status === 404 ? "notFound" : status === 429 ? "rateLimited" : status === 503 ? "credentialsMissing" : "upstreamFailed";
    return Response.json({ error: code }, { status, headers });
  }
}

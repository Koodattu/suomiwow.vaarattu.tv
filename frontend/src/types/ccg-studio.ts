import type { CcgCard, CcgCustomFinish, CcgTierGrade } from "./index";

export type SupporterModerationRow = { _id: string; name: string; realm: string; cardId: string; editsFrozen: boolean; distributable: boolean };
export type SupporterMedia = { id: string; sourceId: string; kind: "image" | "audio";
  status: "processing" | "pending" | "approved" | "rejected" | "withdrawn" | "superseded" | "failed";
  url: string | null; reason: string | null; width?: number; height?: number; duration?: number; createdAt: string;
  aiReview?: { decision: "safe" | "review" | "reject" | "error"; safetyConfidence: number | null; reason: string; model: string; autoApproved: boolean; reviewedAt: string } | null };
export type SupporterMediaQueue = { submissions: SupporterMedia[]; sources: Array<{ _id: string; name: string; realm: string; cardId: string }> };

export type StudioDraft = {
  specName: string; role: "tank" | "healer" | "dps"; tierGrade: CcgTierGrade; creatorFinish: CcgCustomFinish;
  performance: number | null; mechanics: number | null; mythicPlus: number | null;
  backgroundId?: string; backgroundOffsetX?: number;
};
export type StudioCreation = {
  id: string; cardId: string | null; characterId: number; realmId: number; name: string; realm: string; classID: number;
  revision: number; draft: StudioDraft | null; creatorFinish: CcgCustomFinish | null; tierGrade: CcgTierGrade | null;
  editsFrozen: boolean; nextEditAt: string; nextRenderRefreshAt: string; renderError: boolean; renderUnchanged: boolean; preview: CcgCard | null;
};
export type StudioState = {
  rewards: { packsPerCard: number; availablePacks: number };
  region: "eu"; battlenetConnected: boolean; twitchConnected: boolean; rosterError: string | null;
  entitlements: { base: number; follower: boolean; subscriber: boolean };
  allowance: { earned: number; used: number; available: number; drafts: number; draftLimit: number };
  status: { tracking: boolean; following: boolean | null; subscribed: boolean | null; checkedAt: string | null;
    error: string | null; nextCheckAt: string; nextManualCheckAt: string; firstSubscriberMonth: string | null };
  finishes: CcgCustomFinish[]; classes: Array<{ id: number; name: string; specs: Array<{ name: string; role: StudioDraft["role"] }> }>;
  backgrounds: Array<{ id: string; name: string; path: string; crop: { x: number; y: number; scale: number } }>;
  creations: StudioCreation[];
  media: SupporterMedia[];
  characters: Array<{ id: number; realmId: number; name: string; realm: string; className: string; level: number;
    cards: Array<CcgCard & { snapshots: number; owned: number }> }>;
};

export type StudioOverview = Omit<StudioState, "characters" | "rosterError">;
export type StudioCharacters = Pick<StudioState, "characters" | "rosterError">;
export type StudioRewardClaim = { claimedPacks: number; rewards: StudioState["rewards"] };

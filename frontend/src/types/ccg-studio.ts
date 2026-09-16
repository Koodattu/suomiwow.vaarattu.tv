import type { CcgCard, CcgCustomFinish, CcgTierGrade } from "./index";

export type SupporterModerationRow = { _id: string; name: string; realm: string; cardId: string; editsFrozen: boolean; distributable: boolean };

export type StudioDraft = {
  specName: string; role: "tank" | "healer" | "dps"; tierGrade: CcgTierGrade; creatorFinish: CcgCustomFinish;
  performance: number | null; mechanics: number | null; mythicPlus: number | null;
};
export type StudioCreation = {
  id: string; cardId: string | null; characterId: number; realmId: number; name: string; realm: string; classID: number;
  revision: number; draft: StudioDraft | null; creatorFinish: CcgCustomFinish | null; tierGrade: CcgTierGrade | null;
  editsFrozen: boolean; nextEditAt: string; nextRenderRefreshAt: string; renderError: boolean; renderUnchanged: boolean; preview: CcgCard | null;
};
export type StudioState = {
  region: "eu"; battlenetConnected: boolean; twitchConnected: boolean; rosterError: string | null;
  allowance: { earned: number; used: number; available: number; drafts: number; draftLimit: number };
  status: { tracking: boolean; following: boolean | null; subscribed: boolean | null; checkedAt: string | null;
    error: string | null; nextCheckAt: string; nextManualCheckAt: string; firstSubscriberMonth: string | null };
  finishes: CcgCustomFinish[]; classes: Array<{ id: number; name: string; specs: Array<{ name: string; role: StudioDraft["role"] }> }>;
  creations: StudioCreation[];
  characters: Array<{ id: number; realmId: number; name: string; realm: string; className: string; level: number;
    cards: Array<CcgCard & { snapshots: number; owned: number }> }>;
};

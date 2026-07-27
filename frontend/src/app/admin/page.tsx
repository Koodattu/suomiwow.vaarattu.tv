"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/context/AuthContext";
import CcgAdminPanel from "@/components/admin/CcgAdminPanel";
import { api } from "@/lib/api";
import { getUmaImageLabel, UMA_IMAGES } from "@/lib/uma-images";
import {
  triggerCalculateAllStatistics,
  triggerCalculateTierLists,
  triggerCheckTwitchStreams,
  triggerUpdateWorldRanks,
  triggerCalculateRaidAnalytics,
  triggerUpdateActiveGuilds,
  triggerUpdateInactiveGuilds,
  triggerUpdateAllGuilds,
  triggerRefetchRecentReports,
  triggerBackfillFightVods,
  triggerUpdateGuildCrests,
  triggerRescanDeathEvents,
  triggerRescanCharacters,
  triggerBackfillReportCharacters,
  triggerBackfillCharacterRankings,
  triggerBackfillCharacterAchievements,
  triggerBackfillMythicPlusHistorical,
  triggerRefreshMythicPlusCurrentSeason,
  triggerRebuildCharacterAccountGroups,
  triggerRebuildGuildNetworkSnapshot,
  triggerRebuildCharacterRankingLeaderboards,
  triggerRebuildCharacterMechanicsLeaderboards,
  triggerRebuildCharacterTierLists,
  triggerPruneCharacterRankingsWithoutMythicEvidence,
  triggerRebuildCharacterRaidParticipations,
  triggerRefreshCharacterRankings,
  triggerSyncRaidsFromWCL,
  triggerUpdateRaiderIOGuilds,
  triggerTwitchBotReconnect,
  triggerTwitchBotReconcile,
  getAdminGuildDetail,
  createAdminGuildLogSource,
  updateAdminGuildLogSource,
  queueAdminGuildLogSourceRescan,
  getGuildLogSourceMigrationPreview,
  migrateExistingGuildToLogSource,
  recalculateGuildStats,
  updateGuildWorldRanks,
  queueGuildRescan,
  queueGuildRescanDeaths,
  queueGuildRescanCharacters,
  queueGuildBackfillReportCharacters,
  verifyGuildReports,
  getAdminGuildReports,
  importAdminGuildReport,
  deleteAdminReport,
  getAdminRaids,
} from "@/lib/api";
import {
  AdminUser,
  AdminUserPickemsResponse,
  AdminGuild,
  AdminTwitchStream,
  AdminTwitchStreamsResponse,
  AdminUserStats,
  AdminGuildStats,
  AdminOverview,
  AdminPickem,
  AdminPickemStats,
  ScoringConfig,
  StreakConfig,
  PrizeConfig,
  RaidInfo,
  PickemType,
  RateLimitStatus,
  RateLimitConfig,
  ProcessorStatus,
  QueueStatistics,
  QueueItem,
  ProcessingStatus,
  ErrorType,
  ProcessingQueueErrorItem,
  TriggerResponse,
  AdminGuildDetail,
  GuildLogSourceMigrationPreview,
  VerifyReportsResponse,
  CreateGuildInput,
  DeleteGuildPreviewResponse,
  DeleteGuildResponse,
  AdminCharacter,
  AdminCharacterIdentityLinkPreview,
  AdminCharacterAccountLinkPreview,
  AdminCharacterStats,
  CharacterRankingBackfillStatusResponse,
  CharacterAchievementBackfillStatusResponse,
  MythicPlusCrawlerStatusResponse,
  AdminRaidOption,
  DeleteCharacterRankingsPreviewResponse,
  TaskLogEntry,
  TaskLogStats,
  AdminGuildReportsResponse,
  AdminReportRaidGroup,
  WarcraftLogsUserAuthStatus,
  WarcraftLogsUserReportProbeResponse,
  TwitchChatBotStatus,
  TwitchBotDifficulty,
  TwitchBotEventType,
  TwitchBotFollowsResponse,
  TwitchBotMessageTemplateKey,
  TwitchBotMessageTemplates,
  TwitchBotSettings,
  TwitchChannelPointsStatus,
  TwitchCustomReward,
} from "@/types";

type TabType = "overview" | "users" | "guilds" | "streams" | "characters" | "pickems" | "ccg" | "system" | "tasks";

const PICKEM_PLACEHOLDER_RAID_ID = -1;

const TWITCH_BOT_EVENT_TYPE_OPTIONS: Array<{ value: TwitchBotEventType; label: string }> = [
  { value: "boss_kill", label: "Boss kills" },
  { value: "best_pull", label: "Best pulls" },
  { value: "milestone", label: "Milestones" },
  { value: "hiatus", label: "Hiatus" },
  { value: "regress", label: "Regressions" },
  { value: "reproge", label: "Reprogression" },
];

const TWITCH_BOT_DIFFICULTY_OPTIONS: Array<{ value: TwitchBotDifficulty; label: string }> = [
  { value: "mythic", label: "Mythic" },
  { value: "heroic", label: "Heroic" },
];

const TWITCH_BOT_TEMPLATE_OPTIONS: Array<{ key: TwitchBotMessageTemplateKey; label: string }> = [
  { key: "bossKill", label: "Boss kill" },
  { key: "bestPull", label: "Best pull" },
  { key: "progressUpdate", label: "Progress update" },
];

const TWITCH_BOT_TEMPLATE_PLACEHOLDERS = [
  { token: "guild_name", label: "Guild" },
  { token: "boss_name", label: "Boss" },
  { token: "difficulty", label: "Difficulty" },
  { token: "difficulty_short", label: "Diff short" },
  { token: "pulls", label: "Pulls" },
  { token: "pulls_phrase", label: "Pull phrase" },
  { token: "progress", label: "Progress" },
  { token: "url", label: "URL" },
  { token: "url_suffix", label: "URL suffix" },
  { token: "event_type", label: "Event type" },
] as const;

const TWITCH_BOT_DEFAULT_MESSAGE_TEMPLATES: TwitchBotMessageTemplates = {
  bossKill: "{difficulty} kill: {guild_name} defeated {boss_name}{pulls_phrase}.{url_suffix}",
  bestPull: "Best pull: {guild_name} reached {progress} on {boss_name}{pulls_phrase}.{url_suffix}",
  progressUpdate: "{difficulty}: {guild_name} updated progress on {boss_name}.{url_suffix}",
};

// Sortable item for finalization ranking with remove button
function SortableRankingItem({ id, rank, onRemove }: { id: string; rank: number; onRemove?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 p-2 bg-gray-700 rounded-lg border border-gray-600 hover:border-gray-500">
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-white p-1"
        aria-label="Drag to reorder"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
        </svg>
      </button>
      <span className="w-7 h-7 flex items-center justify-center bg-blue-600 rounded-full text-white font-bold text-sm">{rank}</span>
      <span className="text-white font-medium text-sm flex-1 truncate">{id}</span>
      {onRemove && (
        <button type="button" onClick={() => onRemove(id)} className="text-gray-400 hover:text-red-400 p-1 transition-colors" aria-label="Remove guild">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

function ManualActionCard({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <h3 className="text-white font-medium flex items-center gap-2 text-balance">
        <span>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

function ManualActionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function MythicPlusCrawlerStatusPanel({ status }: { status: MythicPlusCrawlerStatusResponse }) {
  const queue = status.queue;
  const progressPercent = queue.total > 0 ? Math.round((queue.terminal / queue.total) * 100) : 0;
  const currentJob = status.processor.currentJob;

  return (
    <div className="rounded bg-gray-900/60 border border-gray-700 p-3 text-xs text-gray-300 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-white">Mythic+ crawler</span>
        <span className={status.processor.isRunning ? "text-blue-400" : "text-gray-400"}>{status.processor.isRunning ? "Running" : "Idle"}</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div className="h-1.5 rounded-full bg-cyan-500" style={{ width: `${Math.min(100, progressPercent)}%` }} />
      </div>
      <div className="grid grid-cols-5 gap-2 text-center tabular-nums">
        <div>
          <div className="text-amber-400 font-semibold">{queue.pending}</div>
          <div className="text-gray-500">pending</div>
        </div>
        <div>
          <div className="text-blue-400 font-semibold">{queue.inProgress}</div>
          <div className="text-gray-500">running</div>
        </div>
        <div>
          <div className="text-green-400 font-semibold">{queue.completed}</div>
          <div className="text-gray-500">done</div>
        </div>
        <div>
          <div className="text-cyan-300 font-semibold">{queue.rateLimited}</div>
          <div className="text-gray-500">delayed</div>
        </div>
        <div>
          <div className="text-red-400 font-semibold">{queue.failed}</div>
          <div className="text-gray-500">failed</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-gray-500 tabular-nums">
        <span>{progressPercent}% complete</span>
        <span>
          {status.processor.requestsInWindow}/{status.processor.maxRequestsPerHour} requests
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
        <div>
          <div className="text-cyan-300 font-semibold">{queue.profileSeasonsWritten.toLocaleString()}</div>
          <div className="text-gray-500">season rows</div>
        </div>
        <div>
          <div className="text-sky-300 font-semibold">{queue.detailJobsQueued.toLocaleString()}</div>
          <div className="text-gray-500">detail jobs</div>
        </div>
        <div>
          <div className="text-emerald-300 font-semibold">{queue.dungeonRunsWritten.toLocaleString()}</div>
          <div className="text-gray-500">run rows</div>
        </div>
      </div>
      {(queue.notFound > 0 || queue.classMismatch > 0 || queue.skipped > 0) && (
        <div className="flex items-center justify-between text-gray-500 tabular-nums">
          <span>{queue.skipped} skipped</span>
          <span>
            {queue.notFound} missing / {queue.classMismatch} class mismatch
          </span>
        </div>
      )}
      {currentJob && (
        <div className="text-gray-400 truncate">
          Current: {currentJob.name}-{currentJob.realm}
          {currentJob.season ? ` / ${currentJob.season}` : currentJob.targetSeasons.length ? ` / ${currentJob.targetSeasons.join(", ")}` : ""}
        </div>
      )}
      {status.processor.lastMessage && <div className="text-gray-500 truncate">{status.processor.lastMessage}</div>}
      {status.recentFailures.length > 0 && <div className="text-red-400 truncate">{status.recentFailures.length} recent failure(s)</div>}
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const t = useTranslations("admin");

  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Overview data
  const [overview, setOverview] = useState<AdminOverview | null>(null);

  // Users data
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userStats, setUserStats] = useState<AdminUserStats | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  const [showUserPickemsModal, setShowUserPickemsModal] = useState(false);
  const [selectedUserForPickems, setSelectedUserForPickems] = useState<AdminUser | null>(null);
  const [userPickemsData, setUserPickemsData] = useState<AdminUserPickemsResponse | null>(null);
  const [userPickemsLoading, setUserPickemsLoading] = useState(false);
  const [userPickemsError, setUserPickemsError] = useState<string | null>(null);

  // Guilds data
  const [guilds, setGuilds] = useState<AdminGuild[]>([]);
  const [guildStats, setGuildStats] = useState<AdminGuildStats | null>(null);
  const [guildsPage, setGuildsPage] = useState(1);
  const [guildsTotalPages, setGuildsTotalPages] = useState(1);
  const [guildSearch, setGuildSearch] = useState("");
  const [guildSearchDebounced, setGuildSearchDebounced] = useState("");
  const [twitchStreams, setTwitchStreams] = useState<AdminTwitchStream[]>([]);
  const [twitchStreamStats, setTwitchStreamStats] = useState<AdminTwitchStreamsResponse["stats"] | null>(null);
  const [twitchStreamSearch, setTwitchStreamSearch] = useState("");
  const [twitchBotStatus, setTwitchBotStatus] = useState<TwitchChatBotStatus | null>(null);
  const [twitchBotSettingsDraft, setTwitchBotSettingsDraft] = useState<TwitchBotSettings | null>(null);
  const [twitchBotFollows, setTwitchBotFollows] = useState<TwitchBotFollowsResponse | null>(null);
  const [twitchBotFollowsLoading, setTwitchBotFollowsLoading] = useState(false);
  const [twitchBotTableDataLoading, setTwitchBotTableDataLoading] = useState(false);
  const [twitchBotSettingsSaving, setTwitchBotSettingsSaving] = useState(false);
  const [activeTwitchTemplateKey, setActiveTwitchTemplateKey] = useState<TwitchBotMessageTemplateKey>("bossKill");
  const [twitchChannelPointsStatus, setTwitchChannelPointsStatus] = useState<TwitchChannelPointsStatus | null>(null);
  const [twitchChannelPointRewards, setTwitchChannelPointRewards] = useState<TwitchCustomReward[]>([]);
  const [twitchChannelPointsEnabled, setTwitchChannelPointsEnabled] = useState(false);
  const [twitchChannelPointsRewardTitle, setTwitchChannelPointsRewardTitle] = useState("");
  const [twitchChannelPointsSaving, setTwitchChannelPointsSaving] = useState(false);

  // Characters data
  const [characters, setCharacters] = useState<AdminCharacter[]>([]);
  const [characterStats, setCharacterStats] = useState<AdminCharacterStats | null>(null);
  const [charactersPage, setCharactersPage] = useState(1);
  const [charactersTotalPages, setCharactersTotalPages] = useState(1);
  const [characterSearch, setCharacterSearch] = useState("");
  const [characterSearchDebounced, setCharacterSearchDebounced] = useState("");
  const [editingBlizzardIdentity, setEditingBlizzardIdentity] = useState<{ characterId: string; name: string; realm: string } | null>(null);
  const [blizzardIdentitySavingId, setBlizzardIdentitySavingId] = useState<string | null>(null);
  const [editingIdentityLink, setEditingIdentityLink] = useState<{
    characterId: string;
    name: string;
    realm: string;
    region: string;
    classID: number;
  } | null>(null);
  const [identityLinkPreview, setIdentityLinkPreview] = useState<AdminCharacterIdentityLinkPreview | null>(null);
  const [identityLinkLoading, setIdentityLinkLoading] = useState(false);
  const [editingAccountLink, setEditingAccountLink] = useState<{ characterId: string; name: string; realm: string; region: string } | null>(null);
  const [accountLinkPreview, setAccountLinkPreview] = useState<AdminCharacterAccountLinkPreview | null>(null);
  const [accountLinkLoading, setAccountLinkLoading] = useState(false);

  // Pickems data
  const [pickems, setPickems] = useState<AdminPickem[]>([]);
  const [pickemStats, setPickemStats] = useState<AdminPickemStats | null>(null);
  const [showPickemForm, setShowPickemForm] = useState(false);
  const [editingPickem, setEditingPickem] = useState<AdminPickem | null>(null);
  const [raids, setRaids] = useState<RaidInfo[]>([]);

  // System tab data (Rate Limits & Processing Queue)
  const [rateLimitStatus, setRateLimitStatus] = useState<RateLimitStatus | null>(null);
  const [rateLimitConfig, setRateLimitConfig] = useState<RateLimitConfig | null>(null);
  const [wclUserAuthStatus, setWclUserAuthStatus] = useState<WarcraftLogsUserAuthStatus | null>(null);
  const [wclProbeReportCode, setWclProbeReportCode] = useState("");
  const [wclProbeResult, setWclProbeResult] = useState<WarcraftLogsUserReportProbeResponse | null>(null);
  const [processorStatus, setProcessorStatus] = useState<ProcessorStatus | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStatistics | null>(null);
  const [characterRankingBackfillStatus, setCharacterRankingBackfillStatus] = useState<CharacterRankingBackfillStatusResponse | null>(null);
  const [characterAchievementBackfillStatus, setCharacterAchievementBackfillStatus] = useState<CharacterAchievementBackfillStatusResponse | null>(null);
  const [mythicPlusCrawlerStatus, setMythicPlusCrawlerStatus] = useState<MythicPlusCrawlerStatusResponse | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queuePage, setQueuePage] = useState(1);
  const [queueTotalPages, setQueueTotalPages] = useState(1);
  const [queueFilter, setQueueFilter] = useState<ProcessingStatus | "">("");
  const [systemRefreshInterval, setSystemRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  // Error tracking state
  const [errorItems, setErrorItems] = useState<ProcessingQueueErrorItem[]>([]);
  const [errorFilter, setErrorFilter] = useState<ErrorType | "all">("all");
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Task logs data
  const [taskLogs, setTaskLogs] = useState<TaskLogEntry[]>([]);
  const [taskLatest, setTaskLatest] = useState<TaskLogEntry[]>([]);
  const [taskStats, setTaskStats] = useState<TaskLogStats | null>(null);
  const [taskView, setTaskView] = useState<"latest" | "history">("latest");

  // Scheduler trigger status
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [triggerMessage, setTriggerMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [triggerCooldowns, setTriggerCooldowns] = useState<Record<string, boolean>>({});

  // Statistics & Analytics - raid tier selector
  const [adminRaids, setAdminRaids] = useState<AdminRaidOption[]>([]);
  const [selectedStatRaidId, setSelectedStatRaidId] = useState<string>("current");

  // Guild detail modal
  const [selectedGuild, setSelectedGuild] = useState<AdminGuildDetail | null>(null);
  const [showGuildDetail, setShowGuildDetail] = useState(false);
  const [guildDetailLoading, setGuildDetailLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyReportsResponse | null>(null);
  const [showAddLogSourceModal, setShowAddLogSourceModal] = useState(false);
  const [addLogSourceForm, setAddLogSourceForm] = useState({ name: "", realm: "", region: "EU", queueInitialScan: true });
  const [logSourceActionLoading, setLogSourceActionLoading] = useState<string | null>(null);
  const [showMigrateGuildModal, setShowMigrateGuildModal] = useState(false);
  const [migrationSearch, setMigrationSearch] = useState("");
  const [migrationCandidates, setMigrationCandidates] = useState<AdminGuild[]>([]);
  const [migrationCandidate, setMigrationCandidate] = useState<AdminGuild | null>(null);
  const [migrationPreview, setMigrationPreview] = useState<GuildLogSourceMigrationPreview | null>(null);
  const [migrationConfirmation, setMigrationConfirmation] = useState("");
  const [migrationLoading, setMigrationLoading] = useState(false);

  // Report management modal
  const [showReportManagement, setShowReportManagement] = useState(false);
  const [guildReports, setGuildReports] = useState<AdminGuildReportsResponse | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [manualReportCode, setManualReportCode] = useState("");
  const [manualReportSourceId, setManualReportSourceId] = useState("");
  const [manualReportImporting, setManualReportImporting] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [reportDeleteConfirm, setReportDeleteConfirm] = useState<{ id: string; code: string; fightCount: number } | null>(null);

  // Add Guild modal
  const [showAddGuildModal, setShowAddGuildModal] = useState(false);
  const [addGuildForm, setAddGuildForm] = useState({
    name: "",
    realm: "",
    region: "eu",
    parent_guild: "",
    streamers: "",
  });
  const [addGuildLoading, setAddGuildLoading] = useState(false);

  // Edit Guild modal
  const [showEditGuildModal, setShowEditGuildModal] = useState(false);
  const [editGuildForm, setEditGuildForm] = useState({
    parent_guild: "",
    streamers: "",
    activityStatus: "active" as "active" | "inactive",
    horseRaceUmaImage: "",
  });
  const [editGuildLoading, setEditGuildLoading] = useState(false);
  const [editGuildTarget, setEditGuildTarget] = useState<{ id: string; name: string } | null>(null);

  // Delete Guild modal
  const [showDeleteGuildModal, setShowDeleteGuildModal] = useState(false);
  const [deleteGuildPreview, setDeleteGuildPreview] = useState<DeleteGuildPreviewResponse | null>(null);
  const [deleteGuildLoading, setDeleteGuildLoading] = useState(false);
  const [guildToDelete, setGuildToDelete] = useState<{ id: string; name: string } | null>(null);

  // Delete Character Rankings
  const [deleteRankingsRaidId, setDeleteRankingsRaidId] = useState<string>("");
  const [deleteRankingsPartition, setDeleteRankingsPartition] = useState<string>("");
  const [deleteRankingsPreview, setDeleteRankingsPreview] = useState<DeleteCharacterRankingsPreviewResponse | null>(null);
  const [deleteRankingsLoading, setDeleteRankingsLoading] = useState(false);
  const [showDeleteRankingsConfirm, setShowDeleteRankingsConfirm] = useState(false);

  // Pickem form state
  const [pickemForm, setPickemForm] = useState({
    pickemId: "",
    name: "",
    type: "regular" as PickemType,
    raidIds: [] as number[],
    guildCount: 10,
    finalRankingsCount: 0,
    scoreOutOfRangeGuilds: false,
    votingStart: "",
    votingEnd: "",
    active: true,
    scoringConfig: {
      exactMatch: 10,
      offByOne: 8,
      offByTwo: 6,
      offByThree: 4,
      offByFour: 2,
      offByFiveOrMore: 0,
    } as ScoringConfig,
    streakConfig: {
      enabled: true,
      minLength: 2,
      bonusPerGuild: 3,
    } as StreakConfig,
    prizeConfig: {
      enabled: false,
      goldPool: 0,
      distribution: [] as { place: number; percentage: number }[],
      description: "",
    },
  });

  // RWF Finalization state
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [finalizingPickem, setFinalizingPickem] = useState<AdminPickem | null>(null);
  const [finalizationRankings, setFinalizationRankings] = useState<string[]>([]);
  const [allRwfGuilds, setAllRwfGuilds] = useState<string[]>([]);
  const [finalizeSearch, setFinalizeSearch] = useState("");
  const [isFinalizingLoading, setIsFinalizingLoading] = useState(false);

  // DnD sensors for finalization modal
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Redirect non-admin users
  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const wclUserResult = params.get("wclUser");
    const twitchBotResult = params.get("twitchBot");
    const twitchChannelPointsResult = params.get("twitchChannelPoints");
    if (!wclUserResult && !twitchBotResult && !twitchChannelPointsResult) return;

    setActiveTab((twitchBotResult || twitchChannelPointsResult) && !wclUserResult ? "streams" : "system");
    if (wclUserResult === "connected") {
      setTriggerMessage({ type: "success", text: "Warcraft Logs user authorization connected" });
    } else if (wclUserResult) {
      setTriggerMessage({ type: "error", text: `Warcraft Logs authorization failed: ${params.get("reason") || "unknown error"}` });
    } else if (twitchBotResult === "connected") {
      setTriggerMessage({ type: "success", text: "Twitch bot authorization connected" });
    } else if (twitchBotResult) {
      setTriggerMessage({ type: "error", text: `Twitch bot authorization failed: ${params.get("reason") || "unknown error"}` });
    } else if (twitchChannelPointsResult === "connected") {
      setTriggerMessage({ type: "success", text: "Twitch channel points broadcaster connected" });
    } else {
      setTriggerMessage({ type: "error", text: `Twitch channel points authorization failed: ${params.get("reason") || "unknown error"}` });
    }
    setTimeout(() => setTriggerMessage(null), 7000);
    router.replace("/admin");
  }, [router]);

  // Fetch data based on active tab
  useEffect(() => {
    if (!user?.isAdmin) return;

    const fetchData = async () => {
      const isInitialLoad = !overview && !users.length && !guilds.length && !twitchStreams.length && !characters.length && !pickems.length && !rateLimitStatus;
      if (isInitialLoad) {
        setLoading(true);
      }
      setTableLoading(true);
      setError(null);

      try {
        switch (activeTab) {
          case "overview": {
            const [overviewData, rateLimitData, queueStatsData, adminRaidsData, characterRankingBackfillData, characterAchievementBackfillData, mythicPlusCrawlerData] = await Promise.all([
              api.getAdminOverview(),
              api.getAdminRateLimitStatus(),
              api.getAdminProcessingQueueStats(),
              getAdminRaids(),
              api.getAdminCharacterRankingBackfillStatus(),
              api.getAdminCharacterAchievementBackfillStatus(),
              api.getAdminMythicPlusCrawlerStatus(),
            ]);
            setOverview(overviewData);
            setRateLimitStatus(rateLimitData.status);
            setRateLimitConfig(rateLimitData.config);
            setProcessorStatus(queueStatsData.processor);
            setQueueStats(queueStatsData.queue);
            setAdminRaids(adminRaidsData.raids);
            setCharacterRankingBackfillStatus(characterRankingBackfillData);
            setCharacterAchievementBackfillStatus(characterAchievementBackfillData);
            setMythicPlusCrawlerStatus(mythicPlusCrawlerData);
            break;
          }

          case "users": {
            const [usersData, userStatsData] = await Promise.all([api.getAdminUsers(usersPage), api.getAdminUserStats()]);
            setUsers(usersData.users);
            setUsersTotalPages(usersData.pagination.totalPages);
            setUserStats(userStatsData);
            break;
          }

          case "guilds": {
            const [guildsData, guildStatsData] = await Promise.all([api.getAdminGuilds(guildsPage, 20, guildSearchDebounced || undefined), api.getAdminGuildStats()]);
            setGuilds(guildsData.guilds);
            setGuildsTotalPages(guildsData.pagination.totalPages);
            setGuildStats(guildStatsData);
            break;
          }

          case "streams": {
            const [streamsData, twitchBotData, twitchBotFollowsData, channelPointsData, rewardsData] = await Promise.all([
              api.getAdminTwitchStreams(),
              api.getAdminTwitchBotStatus(),
              api.getAdminTwitchBotFollows().catch(() => null),
              api.getAdminTwitchChannelPointsStatus(),
              api.getAdminTwitchChannelPointRewards().catch(() => null),
            ]);
            setTwitchStreams(streamsData.streams);
            setTwitchStreamStats(streamsData.stats);
            setTwitchBotStatus(twitchBotData);
            setTwitchBotSettingsDraft(twitchBotData.settings);
            setTwitchBotFollows(twitchBotFollowsData);
            setTwitchChannelPointsStatus(channelPointsData);
            setTwitchChannelPointsEnabled(channelPointsData.rewardEnabled);
            setTwitchChannelPointsRewardTitle(channelPointsData.rewardTitle || "");
            setTwitchChannelPointRewards(rewardsData?.rewards || []);
            break;
          }

          case "characters": {
            const [charsData, charStatsData] = await Promise.all([api.getAdminCharacters(charactersPage, 50, characterSearchDebounced || undefined), api.getAdminCharacterStats()]);
            setCharacters(charsData.characters);
            setCharactersTotalPages(charsData.pagination.totalPages);
            setCharacterStats(charStatsData);
            break;
          }

          case "pickems": {
            const [pickemsData, raidsData] = await Promise.all([api.getAdminPickems(), api.getRaids()]);
            setPickems(pickemsData.pickems);
            setPickemStats(pickemsData.stats);
            setRaids(raidsData);
            break;
          }

          case "system": {
            const [rateLimitData, wclUserAuthData, queueStatsData, queueData, errorsData, characterRankingBackfillData, characterAchievementBackfillData, mythicPlusCrawlerData] = await Promise.all([
              api.getAdminRateLimitStatus(),
              api.getAdminWarcraftLogsUserAuthStatus(),
              api.getAdminProcessingQueueStats(),
              api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined),
              api.getAdminProcessingQueueErrors(1, 50),
              api.getAdminCharacterRankingBackfillStatus(),
              api.getAdminCharacterAchievementBackfillStatus(),
              api.getAdminMythicPlusCrawlerStatus(),
            ]);
            setRateLimitStatus(rateLimitData.status);
            setRateLimitConfig(rateLimitData.config);
            setWclUserAuthStatus(wclUserAuthData);
            setProcessorStatus(queueStatsData.processor);
            setQueueStats(queueStatsData.queue);
            setQueueItems(queueData.items);
            setQueueTotalPages(queueData.pagination.totalPages);
            setErrorItems(errorsData.items);
            setCharacterRankingBackfillStatus(characterRankingBackfillData);
            setCharacterAchievementBackfillStatus(characterAchievementBackfillData);
            setMythicPlusCrawlerStatus(mythicPlusCrawlerData);
            break;
          }

          case "ccg":
            break;

          case "tasks": {
            const [logsData, latestData] = await Promise.all([api.getAdminTaskLogs(100), api.getAdminTaskLogsLatest()]);
            setTaskLogs(logsData.logs);
            setTaskLatest(latestData.tasks);
            setTaskStats(latestData.stats);
            break;
          }
        }
      } catch (err) {
        console.error("Error fetching admin data:", err);
        setError("Failed to load data");
      } finally {
        setLoading(false);
        setTableLoading(false);
      }
    };

    fetchData();
  }, [activeTab, user?.isAdmin, usersPage, guildsPage, charactersPage, queuePage, queueFilter, guildSearchDebounced, characterSearchDebounced]);

  // Debounce guild search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setGuildSearchDebounced((prev) => {
        if (prev !== guildSearch) {
          setGuildsPage(1);
        }
        return guildSearch;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [guildSearch]);

  // Debounce character search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setCharacterSearchDebounced((prev) => {
        if (prev !== characterSearch) {
          setCharactersPage(1);
        }
        return characterSearch;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [characterSearch]);

  // Auto-refresh system tab every 10 seconds
  useEffect(() => {
    if (activeTab === "system" && user?.isAdmin) {
      const interval = setInterval(async () => {
        try {
          const [rateLimitData, wclUserAuthData, queueStatsData, queueData, errorsData, characterRankingBackfillData, characterAchievementBackfillData, mythicPlusCrawlerData] = await Promise.all([
            api.getAdminRateLimitStatus(),
            api.getAdminWarcraftLogsUserAuthStatus(),
            api.getAdminProcessingQueueStats(),
            api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined),
            api.getAdminProcessingQueueErrors(1, 50),
            api.getAdminCharacterRankingBackfillStatus(),
            api.getAdminCharacterAchievementBackfillStatus(),
            api.getAdminMythicPlusCrawlerStatus(),
          ]);
          setRateLimitStatus(rateLimitData.status);
          setRateLimitConfig(rateLimitData.config);
          setWclUserAuthStatus(wclUserAuthData);
          setProcessorStatus(queueStatsData.processor);
          setQueueStats(queueStatsData.queue);
          setQueueItems(queueData.items);
          setQueueTotalPages(queueData.pagination.totalPages);
          setErrorItems(errorsData.items);
          setCharacterRankingBackfillStatus(characterRankingBackfillData);
          setCharacterAchievementBackfillStatus(characterAchievementBackfillData);
          setMythicPlusCrawlerStatus(mythicPlusCrawlerData);
        } catch (err) {
          console.error("Error refreshing system data:", err);
        }
      }, 10000);

      setSystemRefreshInterval(interval);
      return () => clearInterval(interval);
    } else if (systemRefreshInterval) {
      clearInterval(systemRefreshInterval);
      setSystemRefreshInterval(null);
    }
  }, [activeTab, user?.isAdmin, queuePage, queueFilter]);

  // Auto-refresh lightweight backfill/rate-limit status on the overview tab
  useEffect(() => {
    if (activeTab !== "overview" || !user?.isAdmin) return;

    const interval = setInterval(async () => {
      try {
        const [rateLimitData, characterRankingBackfillData, characterAchievementBackfillData, mythicPlusCrawlerData] = await Promise.all([
          api.getAdminRateLimitStatus(),
          api.getAdminCharacterRankingBackfillStatus(),
          api.getAdminCharacterAchievementBackfillStatus(),
          api.getAdminMythicPlusCrawlerStatus(),
        ]);
        setRateLimitStatus(rateLimitData.status);
        setRateLimitConfig(rateLimitData.config);
        setCharacterRankingBackfillStatus(characterRankingBackfillData);
        setCharacterAchievementBackfillStatus(characterAchievementBackfillData);
        setMythicPlusCrawlerStatus(mythicPlusCrawlerData);
      } catch (err) {
        console.error("Error refreshing overview status:", err);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [activeTab, user?.isAdmin]);

  // Auto-refresh tasks tab every 10 seconds
  useEffect(() => {
    if (activeTab === "tasks" && user?.isAdmin) {
      const interval = setInterval(async () => {
        try {
          const [logsData, latestData] = await Promise.all([api.getAdminTaskLogs(100), api.getAdminTaskLogsLatest()]);
          setTaskLogs(logsData.logs);
          setTaskLatest(latestData.tasks);
          setTaskStats(latestData.stats);
        } catch (err) {
          console.error("Error refreshing task data:", err);
        }
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab, user?.isAdmin]);

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-amber-400 text-xl">{t("loading")}</div>
      </div>
    );
  }

  // Don't render if not admin
  if (!user?.isAdmin) {
    return null;
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const characterBackfillQueue = characterRankingBackfillStatus?.queue;
  const characterBackfillPercent = characterBackfillQueue && characterBackfillQueue.total > 0 ? Math.round((characterBackfillQueue.terminal / characterBackfillQueue.total) * 100) : 0;
  const characterLeaderboardRebuild = characterRankingBackfillStatus?.leaderboardRebuild;
  const characterLeaderboardRebuildPercent =
    characterLeaderboardRebuild && characterLeaderboardRebuild.totalPairs > 0
      ? Math.round((characterLeaderboardRebuild.processedPairs / characterLeaderboardRebuild.totalPairs) * 100)
      : 0;
  const characterAchievementQueue = characterAchievementBackfillStatus?.queue;
  const characterAchievementPercent =
    characterAchievementQueue && characterAchievementQueue.total > 0 ? Math.round((characterAchievementQueue.terminal / characterAchievementQueue.total) * 100) : 0;
  const mythicPlusQueue = mythicPlusCrawlerStatus?.queue;
  const mythicPlusActiveJobs = mythicPlusQueue ? mythicPlusQueue.pending + mythicPlusQueue.inProgress + mythicPlusQueue.rateLimited : 0;
  const mythicPlusPercent = mythicPlusQueue && mythicPlusQueue.total > 0 ? Math.round((mythicPlusQueue.terminal / mythicPlusQueue.total) * 100) : 0;
  const characterRankingPipelineBusy = characterRankingBackfillStatus?.processor.isRunning || characterRankingBackfillStatus?.leaderboardRebuild.isRunning;
  const queueTotalCount = queueStats ? queueStats.pending + queueStats.inProgress + queueStats.completed + queueStats.failed + queueStats.paused : 0;
  const twitchStreamSearchTerm = twitchStreamSearch.trim().toLowerCase();
  const filteredTwitchStreams = twitchStreamSearchTerm
    ? twitchStreams.filter((stream) => {
        const guildLabel = `${stream.guild.name} ${stream.guild.parentGuild || ""} ${stream.guild.realm} ${stream.guild.region}`;
        return [stream.channelName, stream.gameName, stream.twitchUserId, guildLabel].some((value) => value?.toLowerCase().includes(twitchStreamSearchTerm));
      })
    : twitchStreams;
  const twitchBotFollowedChannels = new Set(twitchBotFollows?.channels.map((channel) => channel.broadcasterLogin.toLowerCase()) || []);
  const twitchBotBannedChannels = new Map(twitchBotStatus?.chat.bannedChannels.map((ban) => [ban.channelName.toLowerCase(), ban]) || []);
  const twitchBotJoinedChannels = new Set(twitchBotStatus?.chat.joinedChannels.map((channel) => channel.toLowerCase()) || []);
  const twitchBotSettingsChanged =
    twitchBotSettingsDraft && twitchBotStatus
      ? JSON.stringify(twitchBotSettingsDraft) !== JSON.stringify(twitchBotStatus.settings)
      : false;
  const activeTwitchTemplateLabel = TWITCH_BOT_TEMPLATE_OPTIONS.find((option) => option.key === activeTwitchTemplateKey)?.label || "Template";

  const getSelectedStatRaidTarget = () => {
    const raidId = selectedStatRaidId !== "all" && selectedStatRaidId !== "current" ? Number(selectedStatRaidId) : undefined;
    const scope = selectedStatRaidId === "all" ? ("all" as const) : ("current" as const);
    return { raidId, scope };
  };

  // Handler for scheduler triggers with 10-second cooldown per button
  const handleTrigger = async (triggerName: string, triggerFn: () => Promise<TriggerResponse>) => {
    setTriggerLoading(triggerName);
    setTriggerMessage(null);
    try {
      const result = await triggerFn();
      setTriggerMessage({ type: "success", text: result.message });
      if (
        triggerName === "backfill-character-rankings" ||
        triggerName === "refresh-character-ranking-candidates" ||
        triggerName === "rebuild-character-ranking-leaderboards" ||
        triggerName === "prune-character-rankings-without-mythic-evidence"
      ) {
        const status = await api.getAdminCharacterRankingBackfillStatus();
        setCharacterRankingBackfillStatus(status);
      }
      if (
        triggerName === "backfill-character-achievements" ||
        triggerName === "refresh-character-achievement-candidates" ||
        triggerName === "refresh-character-achievement-all" ||
        triggerName === "rebuild-character-account-groups"
      ) {
        const status = await api.getAdminCharacterAchievementBackfillStatus();
        setCharacterAchievementBackfillStatus(status);
      }
      if (triggerName === "backfill-mythic-plus-historical" || triggerName === "refresh-mythic-plus-current") {
        const status = await api.getAdminMythicPlusCrawlerStatus();
        setMythicPlusCrawlerStatus(status);
      }
      if (triggerName === "sync-raids-from-wcl") {
        const adminRaidsData = await getAdminRaids();
        setAdminRaids(adminRaidsData.raids);
      }
      if (triggerName === "twitch-bot-reconnect" || triggerName === "twitch-bot-reconcile") {
        await refreshTwitchBotStatus();
      }

      // Set cooldown for this specific button
      setTriggerCooldowns((prev) => ({ ...prev, [triggerName]: true }));
      setTimeout(() => {
        setTriggerCooldowns((prev) => ({ ...prev, [triggerName]: false }));
      }, 10000);

      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to trigger action",
      });
    } finally {
      setTriggerLoading(null);
    }
  };

  const renderTriggerButton = (triggerName: string, label: string, triggerFn: () => Promise<TriggerResponse>, options?: { disabled?: boolean }) => {
    const isLoading = triggerLoading === triggerName;
    const isCoolingDown = triggerCooldowns[triggerName];

    return (
      <button
        onClick={() => handleTrigger(triggerName, triggerFn)}
        disabled={isLoading || isCoolingDown || options?.disabled}
        className="w-full min-h-10 px-3 py-2 bg-gray-700 text-white text-sm rounded hover:bg-gray-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-between gap-3 text-left transition-[background-color,transform]"
      >
        <span className="min-w-0 text-pretty">{label}</span>
        <span className="flex shrink-0 items-center gap-1">
          {isLoading && <span className="animate-spin">⏳</span>}
          {isCoolingDown && <span className="text-xs text-gray-400">⏱️</span>}
        </span>
      </button>
    );
  };

  const refreshWclUserAuthStatus = async () => {
    const status = await api.getAdminWarcraftLogsUserAuthStatus();
    setWclUserAuthStatus(status);
    return status;
  };

  const refreshTwitchBotStatus = async () => {
    const status = await api.getAdminTwitchBotStatus();
    setTwitchBotStatus(status);
    setTwitchBotSettingsDraft(status.settings);
    return status;
  };

  const refreshTwitchChannelPointsStatus = async () => {
    const status = await api.getAdminTwitchChannelPointsStatus();
    setTwitchChannelPointsStatus(status);
    setTwitchChannelPointsEnabled(status.rewardEnabled);
    setTwitchChannelPointsRewardTitle(status.rewardTitle || "");
    return status;
  };

  const refreshTwitchChannelPointRewards = async () => {
    const result = await api.getAdminTwitchChannelPointRewards();
    setTwitchChannelPointRewards(result.rewards);
    return result.rewards;
  };

  const refreshTwitchBotFollows = async () => {
    setTwitchBotFollowsLoading(true);
    try {
      const follows = await api.getAdminTwitchBotFollows();
      setTwitchBotFollows(follows);
      return follows;
    } finally {
      setTwitchBotFollowsLoading(false);
    }
  };

  const refreshTwitchBotTableData = async () => {
    setTwitchBotTableDataLoading(true);
    try {
      const [follows, status] = await Promise.all([api.getAdminTwitchBotFollows(), api.getAdminTwitchBotStatus()]);
      setTwitchBotFollows(follows);
      setTwitchBotStatus((current) => ({ ...status, settings: current?.settings || status.settings }));
    } finally {
      setTwitchBotTableDataLoading(false);
    }
  };

  const toggleTwitchBotEventType = (eventType: TwitchBotEventType) => {
    setTwitchBotSettingsDraft((settings) => {
      if (!settings) return settings;
      const selected = settings.eventTypes.includes(eventType);
      const eventTypes = selected ? settings.eventTypes.filter((value) => value !== eventType) : [...settings.eventTypes, eventType];
      return { ...settings, eventTypes };
    });
  };

  const toggleTwitchBotDifficulty = (difficulty: TwitchBotDifficulty) => {
    setTwitchBotSettingsDraft((settings) => {
      if (!settings) return settings;
      const selected = settings.difficulties.includes(difficulty);
      const difficulties = selected ? settings.difficulties.filter((value) => value !== difficulty) : [...settings.difficulties, difficulty];
      return { ...settings, difficulties };
    });
  };

  const updateTwitchBotTemplate = (templateKey: TwitchBotMessageTemplateKey, value: string) => {
    setTwitchBotSettingsDraft((settings) => {
      if (!settings) return settings;
      return {
        ...settings,
        messageTemplates: {
          ...settings.messageTemplates,
          [templateKey]: value,
        },
      };
    });
  };

  const resetTwitchBotTemplate = (templateKey: TwitchBotMessageTemplateKey) => {
    updateTwitchBotTemplate(templateKey, TWITCH_BOT_DEFAULT_MESSAGE_TEMPLATES[templateKey]);
  };

  const insertTwitchBotTemplatePlaceholder = (token: string) => {
    const placeholder = `{${token}}`;

    setTwitchBotSettingsDraft((settings) => {
      if (!settings) return settings;

      const templateKey = activeTwitchTemplateKey;
      const currentValue = settings.messageTemplates[templateKey] || "";
      const activeElement = document.activeElement;
      const textarea =
        activeElement instanceof HTMLTextAreaElement && activeElement.dataset.twitchBotTemplate === templateKey
          ? activeElement
          : document.querySelector<HTMLTextAreaElement>(`textarea[data-twitch-bot-template="${templateKey}"]`);
      const selectionStart = textarea?.selectionStart ?? currentValue.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
      const insertion = selectionStart > 0 && !/\s$/.test(currentValue.slice(0, selectionStart)) ? ` ${placeholder}` : placeholder;
      const nextValue = `${currentValue.slice(0, selectionStart)}${insertion}${currentValue.slice(selectionEnd)}`;

      window.requestAnimationFrame(() => {
        textarea?.focus();
        const cursorPosition = selectionStart + insertion.length;
        textarea?.setSelectionRange(cursorPosition, cursorPosition);
      });

      return {
        ...settings,
        messageTemplates: {
          ...settings.messageTemplates,
          [templateKey]: nextValue,
        },
      };
    });
  };

  const previewTwitchBotTemplate = (template: string): string => {
    const sampleUrl = "https://suomiwow.vaarattu.tv/guilds/tarren-mill/Example";
    const includeUrl = twitchBotSettingsDraft?.includeUrl ?? true;
    const values: Record<string, string> = {
      guild_name: "Example",
      boss_name: "Chrome King Gallywix",
      difficulty: "Mythic",
      difficulty_short: "M",
      pulls: "124",
      pulls_phrase: " after 124 pulls",
      progress: "12.3%",
      url: includeUrl ? sampleUrl : "",
      url_suffix: includeUrl ? ` ${sampleUrl}` : "",
      event_type: "boss_kill",
    };

    return template.replace(/\{([a-z0-9_]+)\}/gi, (match, key: string) => values[key] ?? match);
  };

  const handleSaveTwitchBotSettings = async () => {
    if (!twitchBotSettingsDraft) return;

    if (twitchBotSettingsDraft.eventTypes.length === 0 || twitchBotSettingsDraft.difficulties.length === 0) {
      setTriggerMessage({ type: "error", text: "Choose at least one event type and one difficulty." });
      return;
    }

    setTwitchBotSettingsSaving(true);
    setTriggerMessage(null);
    try {
      const settings = await api.updateAdminTwitchBotSettings(twitchBotSettingsDraft);
      setTwitchBotSettingsDraft(settings);
      setTwitchBotStatus((status) => (status ? { ...status, settings } : status));
      setTriggerMessage({ type: "success", text: "Twitch bot settings saved" });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save Twitch bot settings",
      });
    } finally {
      setTwitchBotSettingsSaving(false);
    }
  };

  const refreshSystemQueueState = async () => {
    const [queueStatsData, queueData, errorsData] = await Promise.all([
      api.getAdminProcessingQueueStats(),
      api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined),
      api.getAdminProcessingQueueErrors(1, 50),
    ]);
    setProcessorStatus(queueStatsData.processor);
    setQueueStats(queueStatsData.queue);
    setQueueItems(queueData.items);
    setQueueTotalPages(queueData.pagination.totalPages);
    setErrorItems(errorsData.items);
  };

  const handleClearProcessingQueue = async () => {
    if (queueTotalCount === 0) return;

    if (!confirm(`Clear all ${queueTotalCount} guilds from the processing queue? This includes pending, in-progress, completed, failed, and paused guilds.`)) {
      return;
    }

    setTriggerLoading("clear-processing-queue");
    setTriggerMessage(null);
    try {
      const result = await api.clearAdminProcessingQueueAll();
      setTriggerMessage({ type: "success", text: result.message });
      setTimeout(() => setTriggerMessage(null), 5000);
      await refreshSystemQueueState();
    } catch (error) {
      console.error("Failed to clear processing queue:", error);
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to clear processing queue" });
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleConnectWclUser = async () => {
    setTriggerLoading("wcl-user-connect");
    setTriggerMessage(null);
    try {
      const { url } = await api.getAdminWarcraftLogsUserAuthUrl();
      window.location.href = url;
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to start Warcraft Logs authorization",
      });
      setTriggerLoading(null);
    }
  };

  const handleVerifyWclUser = async () => {
    setTriggerLoading("wcl-user-verify");
    setTriggerMessage(null);
    try {
      const result = await api.verifyAdminWarcraftLogsUserAuth();
      await refreshWclUserAuthStatus();
      setTriggerMessage({ type: "success", text: `Warcraft Logs user verified: ${result.user.name}` });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to verify Warcraft Logs user",
      });
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleProbeWclReport = async () => {
    const reportCode = wclProbeReportCode.trim();
    if (!reportCode) {
      setTriggerMessage({ type: "error", text: "Enter a report code to probe" });
      return;
    }

    setTriggerLoading("wcl-user-probe");
    setTriggerMessage(null);
    setWclProbeResult(null);
    try {
      const result = await api.probeAdminWarcraftLogsUserReport(reportCode);
      setWclProbeResult(result);
      const archiveStatus = result.report?.archiveStatus;
      setTriggerMessage({
        type: "success",
        text: archiveStatus
          ? `Report probe complete: archived=${archiveStatus.isArchived ? "yes" : "no"}, accessible=${archiveStatus.isAccessible ? "yes" : "no"}`
          : "Report probe complete",
      });
      await refreshWclUserAuthStatus();
      setTimeout(() => setTriggerMessage(null), 7000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to probe report access",
      });
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleDisconnectWclUser = async () => {
    if (!confirm("Disconnect the stored Warcraft Logs user authorization? Archived report retries will stop working until you connect again.")) {
      return;
    }

    setTriggerLoading("wcl-user-disconnect");
    setTriggerMessage(null);
    try {
      const result = await api.disconnectAdminWarcraftLogsUserAuth();
      await refreshWclUserAuthStatus();
      setTriggerMessage({ type: "success", text: result.message });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to disconnect Warcraft Logs user authorization",
      });
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleConnectTwitchBot = async () => {
    setTriggerLoading("twitch-bot-connect");
    setTriggerMessage(null);
    try {
      const { url } = await api.getAdminTwitchBotAuthUrl();
      window.location.href = url;
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to start Twitch bot authorization",
      });
      setTriggerLoading(null);
    }
  };

  const handleVerifyTwitchBot = async () => {
    setTriggerLoading("twitch-bot-verify");
    setTriggerMessage(null);
    try {
      const result = await api.verifyAdminTwitchBotAuth();
      await refreshTwitchBotStatus();
      await refreshTwitchBotFollows().catch(() => undefined);
      setTriggerMessage({ type: "success", text: `Twitch bot verified: ${result.user.displayName}` });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to verify Twitch bot",
      });
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleDisconnectTwitchBot = async () => {
    if (!confirm("Disconnect the stored Twitch bot authorization? The bot will leave chat after the worker notices the disconnected token.")) {
      return;
    }

    setTriggerLoading("twitch-bot-disconnect");
    setTriggerMessage(null);
    try {
      const result = await api.disconnectAdminTwitchBotAuth();
      await triggerTwitchBotReconnect().catch(() => undefined);
      await refreshTwitchBotStatus();
      setTwitchBotFollows(null);
      setTriggerMessage({ type: "success", text: result.message });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to disconnect Twitch bot authorization",
      });
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleConnectTwitchChannelPoints = async () => {
    setTriggerLoading("twitch-channel-points-connect");
    setTriggerMessage(null);
    try {
      const { url } = await api.getAdminTwitchChannelPointsAuthUrl();
      window.location.href = url;
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to start broadcaster authorization" });
      setTriggerLoading(null);
    }
  };

  const handleVerifyTwitchChannelPoints = async () => {
    setTriggerLoading("twitch-channel-points-verify");
    setTriggerMessage(null);
    try {
      const result = await api.verifyAdminTwitchChannelPointsAuth();
      await Promise.all([refreshTwitchChannelPointsStatus(), refreshTwitchChannelPointRewards()]);
      setTriggerMessage({ type: "success", text: `Channel points broadcaster verified: ${result.user.displayName}` });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to verify broadcaster authorization" });
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleSaveTwitchChannelPoints = async () => {
    if (twitchChannelPointsEnabled && !twitchChannelPointsRewardTitle.trim()) {
      setTriggerMessage({ type: "error", text: "Choose a channel points reward before enabling the listener." });
      return;
    }
    setTwitchChannelPointsSaving(true);
    setTriggerMessage(null);
    try {
      const status = await api.updateAdminTwitchChannelPointsSettings({
        enabled: twitchChannelPointsEnabled,
        rewardTitle: twitchChannelPointsRewardTitle,
      });
      setTwitchChannelPointsStatus(status);
      setTwitchChannelPointsEnabled(status.rewardEnabled);
      setTwitchChannelPointsRewardTitle(status.rewardTitle || twitchChannelPointsRewardTitle);
      setTriggerMessage({ type: "success", text: status.rewardEnabled ? "Channel points listener activated" : "Channel points listener disabled" });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save channel points settings" });
    } finally {
      setTwitchChannelPointsSaving(false);
    }
  };

  const handleDisconnectTwitchChannelPoints = async () => {
    if (!confirm("Disconnect the broadcaster authorization and remove its EventSub subscription? Recorded and pending rewards are kept.")) return;
    setTriggerLoading("twitch-channel-points-disconnect");
    setTriggerMessage(null);
    try {
      const result = await api.disconnectAdminTwitchChannelPointsAuth();
      await refreshTwitchChannelPointsStatus();
      setTwitchChannelPointRewards([]);
      setTriggerMessage({ type: "success", text: result.message });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to disconnect broadcaster authorization" });
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleResetFailedArchivedDeaths = async () => {
    const failed = wclUserAuthStatus?.deathEvents.failed || 0;
    const archived = wclUserAuthStatus?.deathEvents.archived || 0;
    if (!confirm(`Reset ${failed} failed and ${archived} archived death-event fight rows to pending, then queue affected guilds for death rescan?`)) {
      return;
    }

    setTriggerLoading("death-events-reset");
    setTriggerMessage(null);
    try {
      const result = await api.resetAdminFailedArchivedDeathEvents(["failed", "archived"], true);
      setTriggerMessage({ type: "success", text: result.message });
      await Promise.all([refreshWclUserAuthStatus(), refreshSystemQueueState()]);
      setTimeout(() => setTriggerMessage(null), 7000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to reset death event fetches",
      });
    } finally {
      setTriggerLoading(null);
    }
  };

  // Handler for updating guild world ranks
  const handleUpdateGuildWorldRanks = async (guildId: string, guildName: string) => {
    try {
      await updateGuildWorldRanks(guildId);
      setTriggerMessage({ type: "success", text: `World rankings update started for ${guildName}` });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to update world ranks",
      });
    }
  };

  // Handler for opening guild detail modal
  const handleGuildClick = async (guildId: string) => {
    setGuildDetailLoading(true);
    setShowGuildDetail(true);
    setVerifyResult(null);
    try {
      const detail = await getAdminGuildDetail(guildId);
      setSelectedGuild(detail);
    } catch (error) {
      console.error("Failed to fetch guild details:", error);
      setSelectedGuild(null);
    } finally {
      setGuildDetailLoading(false);
    }
  };

  // Handler for verifying guild reports
  const handleVerifyReports = async (guildId: string) => {
    try {
      const result = await verifyGuildReports(guildId);
      setVerifyResult(result);
    } catch (error) {
      console.error("Failed to verify reports:", error);
    }
  };

  // Handler for opening report management modal
  const handleManageReports = async (guildId: string) => {
    setReportsLoading(true);
    setShowReportManagement(true);
    setGuildReports(null);
    setReportDeleteConfirm(null);
    setManualReportCode("");
    setManualReportSourceId(selectedGuild?.logSources.find((source) => source.isPrimary)?.id || "");
    try {
      const data = await getAdminGuildReports(guildId);
      setGuildReports(data);
    } catch (error) {
      console.error("Failed to fetch guild reports:", error);
    } finally {
      setReportsLoading(false);
    }
  };

  const handleImportReport = async (guildId: string) => {
    const reportCode = manualReportCode.trim();
    if (!reportCode) {
      setTriggerMessage({ type: "error", text: "Enter a report code" });
      return;
    }

    if (!/^[a-zA-Z0-9]+$/.test(reportCode)) {
      setTriggerMessage({ type: "error", text: "Report code can only contain letters and numbers" });
      return;
    }

    setManualReportImporting(true);
    try {
      const result = await importAdminGuildReport(guildId, reportCode, manualReportSourceId || undefined);
      setTriggerMessage({ type: "success", text: result.message });
      setManualReportCode("");

      const [reports, detail] = await Promise.all([getAdminGuildReports(guildId), getAdminGuildDetail(guildId)]);
      setGuildReports(reports);
      setSelectedGuild(detail);
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to import report",
      });
    } finally {
      setManualReportImporting(false);
    }
  };

  // Handler for deleting a report
  const handleDeleteReport = async (guildId: string, reportId: string) => {
    setDeletingReportId(reportId);
    try {
      const result = await deleteAdminReport(guildId, reportId);
      setTriggerMessage({ type: "success", text: result.message });
      // Refresh the reports list
      const data = await getAdminGuildReports(guildId);
      setGuildReports(data);
      // Also refresh the guild detail to update counts
      const detail = await getAdminGuildDetail(guildId);
      setSelectedGuild(detail);
      setReportDeleteConfirm(null);
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to delete report",
      });
    } finally {
      setDeletingReportId(null);
    }
  };

  // Handler for queueing guild rescan
  const handleQueueRescan = async (guildId: string, guildName: string) => {
    try {
      await queueGuildRescan(guildId);
      setTriggerMessage({ type: "success", text: `${guildName} queued for rescan` });
      // Refresh guild detail
      const detail = await getAdminGuildDetail(guildId);
      setSelectedGuild(detail);
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to queue rescan",
      });
    }
  };

  // Handler for queueing guild death events rescan
  const handleQueueRescanDeaths = async (guildId: string, guildName: string) => {
    try {
      await queueGuildRescanDeaths(guildId);
      setTriggerMessage({ type: "success", text: `${guildName} queued for death events rescan` });
      if (selectedGuild) {
        const detail = await getAdminGuildDetail(guildId);
        setSelectedGuild(detail);
      }
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to queue death rescan",
      });
    }
  };

  // Handler for queueing guild character rescan
  const handleQueueRescanCharacters = async (guildId: string, guildName: string) => {
    try {
      await queueGuildRescanCharacters(guildId);
      setTriggerMessage({ type: "success", text: `${guildName} queued for character rescan` });
      if (selectedGuild) {
        const detail = await getAdminGuildDetail(guildId);
        setSelectedGuild(detail);
      }
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to queue character rescan",
      });
    }
  };

  // Handler for queueing report-level character backfill
  const handleQueueBackfillReportCharacters = async (guildId: string, guildName: string) => {
    try {
      await queueGuildBackfillReportCharacters(guildId);
      setTriggerMessage({ type: "success", text: `${guildName} queued for report character backfill` });
      if (selectedGuild) {
        const detail = await getAdminGuildDetail(guildId);
        setSelectedGuild(detail);
      }
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to queue report character backfill",
      });
    }
  };

  // Handler for recalculating guild stats
  const handleRecalculateStats = async (guildId: string, guildName: string) => {
    try {
      await recalculateGuildStats(guildId);
      setTriggerMessage({ type: "success", text: `Statistics recalculation started for ${guildName}` });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to recalculate stats",
      });
    }
  };

  const handleAddLogSource = async () => {
    if (!selectedGuild || !addLogSourceForm.name.trim() || !addLogSourceForm.realm.trim()) {
      setTriggerMessage({ type: "error", text: "Source name and realm are required" });
      return;
    }

    setLogSourceActionLoading("add");
    try {
      const result = await createAdminGuildLogSource(selectedGuild.id, {
        name: addLogSourceForm.name.trim(),
        realm: addLogSourceForm.realm.trim(),
        region: addLogSourceForm.region,
        queueInitialScan: addLogSourceForm.queueInitialScan,
      });
      setSelectedGuild(await getAdminGuildDetail(selectedGuild.id));
      setShowAddLogSourceModal(false);
      setAddLogSourceForm({ name: "", realm: "", region: selectedGuild.region.toUpperCase(), queueInitialScan: true });
      setTriggerMessage({
        type: result.warning ? "error" : "success",
        text: result.warning || (result.queueId ? "Historical log source added and queued for its initial scan" : "Historical log source added"),
      });
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to add guild log source" });
    } finally {
      setLogSourceActionLoading(null);
    }
  };

  const handleToggleLogSource = async (sourceId: string, enabled: boolean) => {
    if (!selectedGuild) return;
    setLogSourceActionLoading(sourceId);
    try {
      await updateAdminGuildLogSource(selectedGuild.id, sourceId, { enabled });
      setSelectedGuild(await getAdminGuildDetail(selectedGuild.id));
      setTriggerMessage({ type: "success", text: enabled ? "Log source enabled" : "Log source disabled" });
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to update guild log source" });
    } finally {
      setLogSourceActionLoading(null);
    }
  };

  const handleRescanLogSource = async (sourceId: string) => {
    if (!selectedGuild) return;
    setLogSourceActionLoading(sourceId);
    try {
      await queueAdminGuildLogSourceRescan(selectedGuild.id, sourceId);
      setSelectedGuild(await getAdminGuildDetail(selectedGuild.id));
      setTriggerMessage({ type: "success", text: "Guild log source queued for a full rescan" });
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to queue log source rescan" });
    } finally {
      setLogSourceActionLoading(null);
    }
  };

  const openGuildMigration = () => {
    if (!selectedGuild) return;
    setMigrationSearch("");
    setMigrationCandidates(guilds.filter((guild) => guild.id !== selectedGuild.id));
    setMigrationCandidate(null);
    setMigrationPreview(null);
    setMigrationConfirmation("");
    setShowMigrateGuildModal(true);
  };

  const handleSearchMigrationGuilds = async () => {
    if (!selectedGuild) return;
    setMigrationLoading(true);
    try {
      const response = await api.getAdminGuilds(1, 20, migrationSearch.trim() || undefined);
      setMigrationCandidates(response.guilds.filter((guild) => guild.id !== selectedGuild.id));
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to search guilds" });
    } finally {
      setMigrationLoading(false);
    }
  };

  const handleSelectMigrationGuild = async (candidate: AdminGuild) => {
    if (!selectedGuild) return;
    setMigrationCandidate(candidate);
    setMigrationPreview(null);
    setMigrationConfirmation("");
    setMigrationLoading(true);
    try {
      setMigrationPreview(await getGuildLogSourceMigrationPreview(selectedGuild.id, candidate.id));
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to preview migration" });
    } finally {
      setMigrationLoading(false);
    }
  };

  const handleMigrateGuildToLogSource = async () => {
    if (!selectedGuild || !migrationCandidate || !migrationPreview) return;
    setMigrationLoading(true);
    try {
      const result = await migrateExistingGuildToLogSource(selectedGuild.id, migrationCandidate.id, migrationConfirmation);
      const [detail, guildsData, guildStatsData] = await Promise.all([
        getAdminGuildDetail(selectedGuild.id),
        api.getAdminGuilds(guildsPage, 20, guildSearchDebounced || undefined),
        api.getAdminGuildStats(),
      ]);
      setSelectedGuild(detail);
      setGuilds(guildsData.guilds);
      setGuildsTotalPages(guildsData.pagination.totalPages);
      setGuildStats(guildStatsData);
      setShowMigrateGuildModal(false);
      setTriggerMessage({
        type: result.postProcessing.warnings.length > 0 ? "error" : "success",
        text: [result.message, ...result.postProcessing.warnings].join(" "),
      });
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to migrate existing guild" });
    } finally {
      setMigrationLoading(false);
    }
  };

  // Handler for adding a new guild
  const handleAddGuild = async () => {
    if (!addGuildForm.name.trim() || !addGuildForm.realm.trim()) {
      setTriggerMessage({ type: "error", text: "Guild name and realm are required" });
      return;
    }

    setAddGuildLoading(true);
    try {
      const input: CreateGuildInput = {
        name: addGuildForm.name.trim(),
        realm: addGuildForm.realm.trim(),
        region: addGuildForm.region,
        parent_guild: addGuildForm.parent_guild.trim() || undefined,
        streamers: addGuildForm.streamers.trim()
          ? addGuildForm.streamers
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      };

      const result = await api.createAdminGuild(input);
      setTriggerMessage({ type: "success", text: result.message });
      setTimeout(() => setTriggerMessage(null), 5000);

      // Refresh guilds list
      const guildsData = await api.getAdminGuilds(guildsPage, 20, guildSearchDebounced || undefined);
      setGuilds(guildsData.guilds);
      setGuildsTotalPages(guildsData.pagination.totalPages);
      const guildStatsData = await api.getAdminGuildStats();
      setGuildStats(guildStatsData);

      // Close modal and reset form
      setShowAddGuildModal(false);
      setAddGuildForm({ name: "", realm: "", region: "eu", parent_guild: "", streamers: "" });
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to create guild",
      });
    } finally {
      setAddGuildLoading(false);
    }
  };

  // Handler for opening edit guild modal
  const handleEditGuildClick = () => {
    if (!selectedGuild) return;
    setEditGuildTarget({ id: selectedGuild.id, name: selectedGuild.name });
    setEditGuildForm({
      parent_guild: selectedGuild.parentGuild || "",
      streamers:
        selectedGuild.streamers
          ?.filter((streamer) => streamer.adminManaged !== false)
          .map((streamer) => streamer.channelName)
          .join(", ") || "",
      activityStatus: selectedGuild.activityStatus || "active",
      horseRaceUmaImage: selectedGuild.horseRaceUmaImage || "",
    });
    setShowEditGuildModal(true);
  };

  // Handler for saving guild edits
  const handleSaveGuildEdit = async () => {
    if (!editGuildTarget) return;

    setEditGuildLoading(true);
    try {
      await api.updateAdminGuild(editGuildTarget.id, {
        parent_guild: editGuildForm.parent_guild.trim() || null,
        streamers: editGuildForm.streamers.trim()
          ? editGuildForm.streamers
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        activityStatus: editGuildForm.activityStatus,
        horseRaceUmaImage: editGuildForm.horseRaceUmaImage || null,
      });
      setTriggerMessage({ type: "success", text: `Guild ${editGuildTarget.name} updated` });
      setTimeout(() => setTriggerMessage(null), 5000);

      // Refresh guild detail if open
      const detail = await getAdminGuildDetail(editGuildTarget.id);
      setSelectedGuild(detail);

      // Refresh guilds list
      const guildsData = await api.getAdminGuilds(guildsPage, 20, guildSearchDebounced || undefined);
      setGuilds(guildsData.guilds);
      setGuildsTotalPages(guildsData.pagination.totalPages);

      setShowEditGuildModal(false);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to update guild",
      });
    } finally {
      setEditGuildLoading(false);
    }
  };

  const handleRemoveSelfManagedStreamer = async (channelName: string) => {
    if (!editGuildTarget || !confirm(`Remove ${channelName} from ${editGuildTarget.name} entirely? The user will be able to select the guild again later.`)) return;

    setEditGuildLoading(true);
    try {
      await api.removeAdminGuildStreamer(editGuildTarget.id, channelName);
      const detail = await getAdminGuildDetail(editGuildTarget.id);
      setSelectedGuild(detail);
      setTriggerMessage({ type: "success", text: `${channelName} removed from ${editGuildTarget.name}` });
      setTimeout(() => setTriggerMessage(null), 5000);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to remove guild streamer",
      });
    } finally {
      setEditGuildLoading(false);
    }
  };

  // Handler for clicking delete on a guild - fetches preview
  const handleDeleteGuildClick = async (guildId: string, guildName: string) => {
    setDeleteGuildLoading(true);
    setGuildToDelete({ id: guildId, name: guildName });
    try {
      const preview = await api.getAdminGuildDeletePreview(guildId);
      setDeleteGuildPreview(preview);
      setShowDeleteGuildModal(true);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to get delete preview",
      });
      setGuildToDelete(null);
    } finally {
      setDeleteGuildLoading(false);
    }
  };

  // Handler for confirming guild deletion
  const handleConfirmDeleteGuild = async () => {
    if (!guildToDelete) return;

    setDeleteGuildLoading(true);
    try {
      const result = await api.deleteAdminGuild(guildToDelete.id);
      setTriggerMessage({ type: "success", text: result.message });
      setTimeout(() => setTriggerMessage(null), 5000);

      // Refresh guilds list
      const guildsData = await api.getAdminGuilds(guildsPage, 20, guildSearchDebounced || undefined);
      setGuilds(guildsData.guilds);
      setGuildsTotalPages(guildsData.pagination.totalPages);
      const guildStatsData = await api.getAdminGuildStats();
      setGuildStats(guildStatsData);

      // Close modals
      setShowDeleteGuildModal(false);
      setDeleteGuildPreview(null);
      setGuildToDelete(null);
      setShowGuildDetail(false);
      setSelectedGuild(null);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to delete guild",
      });
    } finally {
      setDeleteGuildLoading(false);
    }
  };

  const refreshAdminCharacters = async () => {
    const charsData = await api.getAdminCharacters(charactersPage, 50, characterSearchDebounced || undefined);
    setCharacters(charsData.characters);
    setCharactersTotalPages(charsData.pagination.totalPages);
  };

  const handleSaveBlizzardIdentity = async () => {
    if (!editingBlizzardIdentity) return;

    setBlizzardIdentitySavingId(editingBlizzardIdentity.characterId);
    try {
      const result = await api.setAdminCharacterBlizzardIdentity(editingBlizzardIdentity.characterId, {
        name: editingBlizzardIdentity.name.trim(),
        realm: editingBlizzardIdentity.realm.trim(),
      });
      setTriggerMessage({ type: "success", text: result.message });
      setEditingBlizzardIdentity(null);
      await refreshAdminCharacters();
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("characters.identitySaveFailed"),
      });
    } finally {
      setBlizzardIdentitySavingId(null);
    }
  };

  const handleClearBlizzardIdentity = async (character: AdminCharacter) => {
    if (!confirm(t("characters.identityClearConfirm", { name: character.blizzardIdentity.name, realm: character.blizzardIdentity.realm }))) return;

    setBlizzardIdentitySavingId(character.id);
    try {
      const result = await api.clearAdminCharacterBlizzardIdentity(character.id);
      setTriggerMessage({ type: "success", text: result.message });
      setEditingBlizzardIdentity(null);
      await refreshAdminCharacters();
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("characters.identityClearFailed"),
      });
    } finally {
      setBlizzardIdentitySavingId(null);
    }
  };

  const handlePreviewIdentityLink = async () => {
    if (!editingIdentityLink) return;
    setIdentityLinkLoading(true);
    setIdentityLinkPreview(null);
    try {
      const preview = await api.previewAdminCharacterIdentityLink(editingIdentityLink.characterId, {
        name: editingIdentityLink.name.trim(),
        realm: editingIdentityLink.realm.trim(),
        region: editingIdentityLink.region.trim(),
        classID: editingIdentityLink.classID,
      });
      setIdentityLinkPreview(preview);
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : t("characters.linkPreviewFailed") });
    } finally {
      setIdentityLinkLoading(false);
    }
  };

  const handleCreateIdentityLink = async () => {
    if (!editingIdentityLink || !identityLinkPreview?.eligible) return;
    setIdentityLinkLoading(true);
    try {
      const result = await api.createAdminCharacterIdentityLink(editingIdentityLink.characterId, identityLinkPreview.source);
      setTriggerMessage({ type: "success", text: result.message });
      setEditingIdentityLink(null);
      setIdentityLinkPreview(null);
      await refreshAdminCharacters();
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : t("characters.linkCreateFailed") });
    } finally {
      setIdentityLinkLoading(false);
    }
  };

  const handleRemoveIdentityLink = async (character: AdminCharacter, linkId: string, alias: string) => {
    if (!confirm(t("characters.linkRemoveConfirm", { alias, target: `${character.name}-${character.realm}` }))) return;
    setIdentityLinkLoading(true);
    try {
      const result = await api.removeAdminCharacterIdentityLink(character.id, linkId);
      setTriggerMessage({ type: "success", text: result.message });
      setEditingIdentityLink(null);
      setIdentityLinkPreview(null);
      await refreshAdminCharacters();
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : t("characters.linkRemoveFailed") });
    } finally {
      setIdentityLinkLoading(false);
    }
  };

  const handlePreviewAccountLink = async () => {
    if (!editingAccountLink) return;
    setAccountLinkLoading(true);
    setAccountLinkPreview(null);
    try {
      const preview = await api.previewAdminCharacterAccountLink(editingAccountLink.characterId, {
        name: editingAccountLink.name.trim(),
        realm: editingAccountLink.realm.trim(),
        region: editingAccountLink.region.trim(),
      });
      setAccountLinkPreview(preview);
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : t("characters.accountLinkPreviewFailed") });
    } finally {
      setAccountLinkLoading(false);
    }
  };

  const handleCreateAccountLink = async () => {
    if (!editingAccountLink || !accountLinkPreview?.eligible) return;
    setAccountLinkLoading(true);
    try {
      const result = await api.createAdminCharacterAccountLink(editingAccountLink.characterId, {
        name: accountLinkPreview.other.name,
        realm: accountLinkPreview.other.realm,
        region: accountLinkPreview.other.region,
      });
      setTriggerMessage({ type: "success", text: result.message });
      setEditingAccountLink(null);
      setAccountLinkPreview(null);
      await refreshAdminCharacters();
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : t("characters.accountLinkCreateFailed") });
    } finally {
      setAccountLinkLoading(false);
    }
  };

  const handleRemoveAccountLink = async (character: AdminCharacter, edgeId: string, otherLabel: string) => {
    if (!confirm(t("characters.accountLinkRemoveConfirm", { character: `${character.name}-${character.realm}`, other: otherLabel }))) return;
    setAccountLinkLoading(true);
    try {
      const result = await api.removeAdminCharacterAccountLink(character.id, edgeId);
      setTriggerMessage({ type: "success", text: result.message });
      setEditingAccountLink(null);
      setAccountLinkPreview(null);
      await refreshAdminCharacters();
    } catch (error) {
      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : t("characters.accountLinkRemoveFailed") });
    } finally {
      setAccountLinkLoading(false);
    }
  };

  // Handler for deleting a character
  const handleDeleteCharacterClick = async (characterId: string, characterName: string, characterRealm: string) => {
    if (!confirm(`Delete character ${characterName}-${characterRealm} and all associated rankings?`)) return;

    setTableLoading(true);
    try {
      const result = await api.deleteAdminCharacter(characterId);
      setTriggerMessage({ type: "success", text: result.message });
      setTimeout(() => setTriggerMessage(null), 5000);

      const [charStatsData] = await Promise.all([api.getAdminCharacterStats(), refreshAdminCharacters()]);
      setCharacterStats(charStatsData);
    } catch (error) {
      setTriggerMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to delete character",
      });
    } finally {
      setTableLoading(false);
    }
  };

  const handleOpenUserPickems = async (adminUser: AdminUser) => {
    setSelectedUserForPickems(adminUser);
    setShowUserPickemsModal(true);
    setUserPickemsLoading(true);
    setUserPickemsError(null);
    setUserPickemsData(null);

    try {
      const data = await api.getAdminUserPickems(adminUser.id);
      setUserPickemsData(data);
    } catch (error) {
      setUserPickemsError(error instanceof Error ? error.message : "Failed to load user pickems");
    } finally {
      setUserPickemsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
            {t("title")}
          </h1>
          <p className="text-gray-400 mt-2">{t("description")}</p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-gray-700 pb-4">
          {(["overview", "users", "guilds", "streams", "characters", "pickems", "ccg", "system", "tasks"] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === tab ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
            >
              {t(`tabs.${tab}`)}
            </button>
          ))}
          <a href="/admin/analytics" className="px-4 py-2 rounded-lg font-medium transition-colors bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center gap-2">
            📊 {t("tabs.analytics")}
          </a>
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-amber-400">{t("loading")}</div>
          </div>
        )}

        {!loading && activeTab === "ccg" && <CcgAdminPanel />}

        {/* Overview Tab */}
        {!loading && activeTab === "overview" && (
          <div className="space-y-6">
            {/* Stats Summary */}
            {overview && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-gray-400 text-sm font-medium">{t("overview.totalUsers")}</h3>
                  <p className="text-3xl font-bold text-white mt-1">{overview.users.total}</p>
                  <p className="text-sm text-gray-500">
                    {overview.users.activeToday} {t("overview.activeToday")}
                  </p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-gray-400 text-sm font-medium">{t("overview.totalGuilds")}</h3>
                  <p className="text-3xl font-bold text-white mt-1">{overview.guilds.total}</p>
                  <p className="text-sm text-gray-500">
                    {overview.guilds.updatedToday} {t("overview.updatedToday")}
                  </p>
                </div>

                {/* Rate Limit Widget */}
                {rateLimitStatus && (
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h3 className="text-gray-400 text-sm font-medium flex items-center gap-1">
                      <span>⚡</span> WCL Rate Limit
                    </h3>
                    <p
                      className={`text-3xl font-bold mt-1 ${
                        rateLimitStatus.percentUsed >= 80 ? "text-red-400" : rateLimitStatus.percentUsed >= 60 ? "text-amber-400" : "text-green-400"
                      }`}
                    >
                      {rateLimitStatus.percentUsed.toFixed(0)}%
                    </p>
                    <div className="w-full bg-gray-600 rounded-full h-1.5 mt-2">
                      <div
                        className={`h-1.5 rounded-full ${rateLimitStatus.percentUsed >= 80 ? "bg-red-500" : rateLimitStatus.percentUsed >= 60 ? "bg-amber-500" : "bg-green-500"}`}
                        style={{ width: `${Math.min(100, rateLimitStatus.percentUsed)}%` }}
                      />
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {rateLimitStatus.pointsRemaining} pts left • Resets in {Math.floor(rateLimitStatus.resetInSeconds / 60)}m
                    </p>
                  </div>
                )}

                {/* Queue Status Widget */}
                {queueStats && (
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h3 className="text-gray-400 text-sm font-medium flex items-center gap-1">
                      <span>📦</span> Processing Queue
                    </h3>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-bold text-white">{queueStats.pending + queueStats.inProgress}</span>
                      <span className="text-gray-500">active</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {queueStats.inProgress > 0 && <span className="text-blue-400">{queueStats.inProgress} processing</span>}
                      {queueStats.inProgress > 0 && queueStats.failed > 0 && " • "}
                      {queueStats.failed > 0 && <span className="text-red-400">{queueStats.failed} failed</span>}
                      {queueStats.inProgress === 0 && queueStats.failed === 0 && "No active jobs"}
                    </p>
                  </div>
                )}

                {mythicPlusCrawlerStatus && mythicPlusQueue && (
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h3 className="text-gray-400 text-sm font-medium flex items-center gap-1">
                      <span>🗝️</span> Mythic+ Crawler
                    </h3>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-bold text-white">{mythicPlusActiveJobs}</span>
                      <span className="text-gray-500">active</span>
                    </div>
                    <div className="w-full bg-gray-600 rounded-full h-1.5 mt-2">
                      <div className="h-1.5 rounded-full bg-cyan-500" style={{ width: `${Math.min(100, mythicPlusPercent)}%` }} />
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {mythicPlusCrawlerStatus.processor.isRunning ? <span className="text-blue-400">Running</span> : "Idle"} • {mythicPlusPercent}% complete
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Trigger Message */}
            {triggerMessage && (
              <div className={`rounded-lg p-4 ${triggerMessage.type === "success" ? "bg-green-900/50 border border-green-500" : "bg-red-900/50 border border-red-500"}`}>
                <p className={triggerMessage.type === "success" ? "text-green-300" : "text-red-300"}>{triggerMessage.text}</p>
              </div>
            )}

            {/* Scheduler Triggers */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>⚙️</span> Manual Actions
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                <ManualActionCard icon="🏰" title="Guild & Report Intake">
                  <ManualActionGroup title="Guild state">
                    {renderTriggerButton("active-guilds", "Check Active Guilds", triggerUpdateActiveGuilds)}
                    {renderTriggerButton("inactive-guilds", "Check Inactive Guilds", triggerUpdateInactiveGuilds)}
                    {renderTriggerButton("all-guilds", "Check All Guilds", triggerUpdateAllGuilds)}
                    {renderTriggerButton("update-raiderio", "Update Raider.IO Guilds", triggerUpdateRaiderIOGuilds)}
                    {renderTriggerButton("guild-crests", "Update Guild Crests", triggerUpdateGuildCrests)}
                  </ManualActionGroup>
                  <ManualActionGroup title="Raid metadata">
                    {renderTriggerButton("sync-raids-from-wcl", "Sync Raids from WCL", triggerSyncRaidsFromWCL)}
                  </ManualActionGroup>
                  <ManualActionGroup title="Report queues">
                    {renderTriggerButton("refetch-reports", "Refetch Recent Reports", triggerRefetchRecentReports)}
                    {renderTriggerButton("rescan-deaths", "Rescan Death Events", triggerRescanDeathEvents)}
                    {renderTriggerButton("rescan-characters", "Rescan Characters", triggerRescanCharacters)}
                    {renderTriggerButton("backfill-report-characters", "Backfill Report Characters", triggerBackfillReportCharacters)}
                  </ManualActionGroup>
                </ManualActionCard>

                <ManualActionCard icon="📊" title="Raid Metrics">
                  <ManualActionGroup title="Target raid tier">
                    <select
                      value={selectedStatRaidId}
                      onChange={(e) => setSelectedStatRaidId(e.target.value)}
                      className="w-full min-h-10 px-3 py-2 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="all">All Raids</option>
                      <option value="current">Current Tier Only</option>
                      {adminRaids.map((raid) => (
                        <option key={raid.id} value={String(raid.id)}>
                          {raid.name}
                          {raid.isPrimary ? " (primary)" : raid.isCurrent ? " (current)" : ""}
                        </option>
                      ))}
                    </select>
                  </ManualActionGroup>
                  <ManualActionGroup title="Derived metrics">
                    {renderTriggerButton("all-statistics", "Calculate Statistics", () => {
                      const { raidId, scope } = getSelectedStatRaidTarget();
                      return triggerCalculateAllStatistics(raidId, scope);
                    })}
                    {renderTriggerButton("tier-lists", "Calculate Tier Lists", () => {
                      const { raidId, scope } = getSelectedStatRaidTarget();
                      return triggerCalculateTierLists(raidId, scope);
                    })}
                    {renderTriggerButton("raid-analytics", "Calculate Raid Analytics", () => {
                      const { raidId, scope } = getSelectedStatRaidTarget();
                      return triggerCalculateRaidAnalytics(raidId, scope);
                    })}
                    {renderTriggerButton("character-mechanics", "Calculate Mechanics Scores", () => {
                      const { raidId, scope } = getSelectedStatRaidTarget();
                      return triggerRebuildCharacterMechanicsLeaderboards(raidId, scope);
                    })}
                    {renderTriggerButton("character-tier-lists", "Rebuild Character Tier Lists", () => {
                      const { raidId, scope } = getSelectedStatRaidTarget();
                      return triggerRebuildCharacterTierLists(raidId, scope);
                    })}
                    {renderTriggerButton("world-ranks", "Update World Ranks", () => {
                      const { raidId, scope } = getSelectedStatRaidTarget();
                      return triggerUpdateWorldRanks(raidId, scope);
                    })}
                  </ManualActionGroup>
                </ManualActionCard>

                <ManualActionCard icon="⚔️" title="Character Ranking Pipeline">
                  <ManualActionGroup title="1. Queue rankings">
                    {renderTriggerButton("backfill-character-rankings", "Backfill Character Rankings", triggerBackfillCharacterRankings)}
                    {renderTriggerButton("refresh-character-ranking-candidates", "Discover Missing Ranking Pairs", () => triggerBackfillCharacterRankings(true))}
                  </ManualActionGroup>
                  <ManualActionGroup title="2. Publish ranking tables">
                    {renderTriggerButton("prune-character-rankings-without-mythic-evidence", "Prune Non-Mythic Ranking Rows", triggerPruneCharacterRankingsWithoutMythicEvidence, {
                      disabled: characterRankingPipelineBusy,
                    })}
                    {renderTriggerButton("rebuild-character-ranking-leaderboards", "Rebuild Character Ranking Tables", triggerRebuildCharacterRankingLeaderboards, {
                      disabled: characterRankingPipelineBusy,
                    })}
                  </ManualActionGroup>
                  {characterRankingBackfillStatus && characterBackfillQueue && (
                    <div className="rounded bg-gray-900/60 border border-gray-700 p-3 text-xs text-gray-300 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-white">Character ranking backfill</span>
                        <span className={characterRankingBackfillStatus.processor.isRunning ? "text-blue-400" : "text-gray-400"}>
                          {characterRankingBackfillStatus.processor.isWaitingForRateLimit
                            ? "Waiting for WCL reset"
                            : characterRankingBackfillStatus.processor.isRunning
                              ? "Running"
                              : "Idle"}
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.min(100, characterBackfillPercent)}%` }} />
                      </div>
                      <div className="grid grid-cols-5 gap-2 text-center tabular-nums">
                        <div>
                          <div className="text-amber-400 font-semibold">{characterBackfillQueue.pending}</div>
                          <div className="text-gray-500">pending</div>
                        </div>
                        <div>
                          <div className="text-blue-400 font-semibold">{characterBackfillQueue.inProgress}</div>
                          <div className="text-gray-500">running</div>
                        </div>
                        <div>
                          <div className="text-green-400 font-semibold">{characterBackfillQueue.completed}</div>
                          <div className="text-gray-500">done</div>
                        </div>
                        <div>
                          <div className="text-gray-400 font-semibold">{characterBackfillQueue.skipped}</div>
                          <div className="text-gray-500">skipped</div>
                        </div>
                        <div>
                          <div className="text-red-400 font-semibold">{characterBackfillQueue.failed}</div>
                          <div className="text-gray-500">failed</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-gray-500 tabular-nums">
                        <span>{characterBackfillPercent}% complete</span>
                        <span>{characterBackfillQueue.rankingsWritten} rankings written</span>
                      </div>
                      {(characterBackfillQueue.observedSpecItems > 0 || characterBackfillQueue.fallbackSpecItems > 0) && (
                        <div className="flex items-center justify-between text-gray-500 tabular-nums">
                          <span>{characterBackfillQueue.observedSpecItems} observed-spec items</span>
                          <span>{characterBackfillQueue.fallbackSpecItems} fallback items</span>
                        </div>
                      )}
                      {characterRankingBackfillStatus.processor.currentItem && (
                        <div className="text-gray-400 truncate">
                          Current: {characterRankingBackfillStatus.processor.currentItem.name}-{characterRankingBackfillStatus.processor.currentItem.realm} /{" "}
                          {characterRankingBackfillStatus.processor.currentItem.raidName ?? `Raid ${characterRankingBackfillStatus.processor.currentItem.zoneId}`}
                        </div>
                      )}
                      {characterLeaderboardRebuild && (characterLeaderboardRebuild.isRunning || characterLeaderboardRebuild.processedPairs > 0 || characterLeaderboardRebuild.lastError) && (
                        <div className="border-t border-gray-700 pt-2 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-white">Leaderboard table rebuild</span>
                            <span className={characterLeaderboardRebuild.isRunning ? "text-blue-400" : characterLeaderboardRebuild.lastError ? "text-red-400" : "text-green-400"}>
                              {characterLeaderboardRebuild.isRunning ? "Running" : characterLeaderboardRebuild.lastError ? "Failed" : "Idle"}
                            </span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, characterLeaderboardRebuildPercent)}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-gray-500 tabular-nums">
                            <span>
                              {characterLeaderboardRebuild.processedPairs}/{characterLeaderboardRebuild.totalPairs} pairs
                            </span>
                            <span>{characterLeaderboardRebuild.writtenEntries} entries written</span>
                          </div>
                          {characterLeaderboardRebuild.lastMessage && <div className="text-gray-400 truncate">{characterLeaderboardRebuild.lastMessage}</div>}
                          {characterLeaderboardRebuild.lastError && <div className="text-red-400 truncate">{characterLeaderboardRebuild.lastError}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </ManualActionCard>

                <ManualActionCard icon="🗝️" title="Mythic+ Pipeline">
                  <ManualActionGroup title="Historical data">
                    {renderTriggerButton("backfill-mythic-plus-historical", "Start Full Historical Backfill", triggerBackfillMythicPlusHistorical, {
                      disabled: mythicPlusCrawlerStatus?.processor.isRunning,
                    })}
                  </ManualActionGroup>
                  <ManualActionGroup title="Current season">
                    {renderTriggerButton("refresh-mythic-plus-current", "Refresh Current Season", triggerRefreshMythicPlusCurrentSeason, {
                      disabled: mythicPlusCrawlerStatus?.processor.isRunning,
                    })}
                  </ManualActionGroup>
                  {mythicPlusCrawlerStatus && <MythicPlusCrawlerStatusPanel status={mythicPlusCrawlerStatus} />}
                </ManualActionCard>

                <ManualActionCard icon="🧬" title="Character Identity Pipeline">
                  <ManualActionGroup title="1. Achievement fingerprints">
                    {renderTriggerButton("backfill-character-achievements", "Start Achievement Backfill", triggerBackfillCharacterAchievements)}
                    {renderTriggerButton("refresh-character-achievement-candidates", "Retry Missing Achievement Fingerprints", () => triggerBackfillCharacterAchievements(true))}
                    {renderTriggerButton("refresh-character-achievement-all", t("characterIdentity.refreshAllAchievementData"), () => triggerBackfillCharacterAchievements(false, true))}
                  </ManualActionGroup>
                  <ManualActionGroup title="2. Account groups">
                    {renderTriggerButton("rebuild-character-account-groups", "Rebuild Character Account Groups", triggerRebuildCharacterAccountGroups, {
                      disabled: characterAchievementBackfillStatus?.processor.isRunning,
                    })}
                  </ManualActionGroup>
                  {characterAchievementBackfillStatus && characterAchievementQueue && (
                    <div className="rounded bg-gray-900/60 border border-gray-700 p-3 text-xs text-gray-300 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-white">Achievement account matching</span>
                        <span className={characterAchievementBackfillStatus.processor.isRunning ? "text-blue-400" : "text-gray-400"}>
                          {characterAchievementBackfillStatus.processor.isWaitingForRateLimit
                            ? "Rate limited"
                            : characterAchievementBackfillStatus.processor.isRunning
                              ? "Running"
                              : "Idle"}
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-cyan-500" style={{ width: `${Math.min(100, characterAchievementPercent)}%` }} />
                      </div>
                      <div className="grid grid-cols-5 gap-2 text-center tabular-nums">
                        <div>
                          <div className="text-amber-400 font-semibold">{characterAchievementQueue.pending}</div>
                          <div className="text-gray-500">pending</div>
                        </div>
                        <div>
                          <div className="text-blue-400 font-semibold">{characterAchievementQueue.inProgress}</div>
                          <div className="text-gray-500">running</div>
                        </div>
                        <div>
                          <div className="text-green-400 font-semibold">{characterAchievementQueue.completed}</div>
                          <div className="text-gray-500">done</div>
                        </div>
                        <div>
                          <div className="text-gray-400 font-semibold">{characterAchievementQueue.notFound}</div>
                          <div className="text-gray-500">missing</div>
                        </div>
                        <div>
                          <div className="text-red-400 font-semibold">{characterAchievementQueue.failed}</div>
                          <div className="text-gray-500">failed</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-gray-500 tabular-nums">
                        <span>{characterAchievementPercent}% complete</span>
                        <span>{characterAchievementBackfillStatus.fingerprints} fingerprints</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                        <div>
                          <div className="text-cyan-300 font-semibold">{characterAchievementBackfillStatus.matches.high}</div>
                          <div className="text-gray-500">high edges</div>
                        </div>
                        <div>
                          <div className="text-sky-300 font-semibold">{characterAchievementBackfillStatus.matches.medium}</div>
                          <div className="text-gray-500">medium edges</div>
                        </div>
                        <div>
                          <div className="text-emerald-300 font-semibold">{characterAchievementBackfillStatus.groups}</div>
                          <div className="text-gray-500">groups</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-gray-500 tabular-nums">
                        <span>{characterAchievementBackfillStatus.signalAchievementCount} signal achievements</span>
                        <span>{characterAchievementBackfillStatus.tokens} indexed tokens</span>
                      </div>
                      <div className="flex items-center justify-between text-gray-500 tabular-nums">
                        <span>{t("characterIdentity.raidSummaries", { count: characterAchievementBackfillStatus.raidAchievementSummaries })}</span>
                        <span>{t("characterIdentity.raidAchievementTargets", { count: characterAchievementBackfillStatus.raidAchievementTargetCount })}</span>
                      </div>
                      {characterAchievementBackfillStatus.processor.currentItem && (
                        <div className="text-gray-400 truncate">
                          Current: {characterAchievementBackfillStatus.processor.currentItem.name}-{characterAchievementBackfillStatus.processor.currentItem.realm}
                        </div>
                      )}
                      {characterAchievementBackfillStatus.processor.lastMessage && <div className="text-gray-500 truncate">{characterAchievementBackfillStatus.processor.lastMessage}</div>}
                    </div>
                  )}
                </ManualActionCard>

                <ManualActionCard icon="🕸️" title="Guild Network Pipeline">
                  <ManualActionGroup title="1. Character raid data">
                    {renderTriggerButton("rebuild-character-raid-participations", "Rebuild Character Raid Data", triggerRebuildCharacterRaidParticipations)}
                  </ManualActionGroup>
                  <ManualActionGroup title="2. Snapshot only">
                    {renderTriggerButton("rebuild-guild-network-snapshot", "Rebuild Guild Network Snapshot", triggerRebuildGuildNetworkSnapshot)}
                  </ManualActionGroup>
                </ManualActionCard>

                <ManualActionCard icon="🎥" title="Streams & VODs">
                  <ManualActionGroup title="Live status">
                    {renderTriggerButton("twitch-streams", "Check Twitch Streams", triggerCheckTwitchStreams)}
                  </ManualActionGroup>
                  <ManualActionGroup title="Fight media">
                    {renderTriggerButton("backfill-fight-vods", "Backfill Best-Pull VODs", triggerBackfillFightVods)}
                  </ManualActionGroup>
                </ManualActionCard>
              </div>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {!loading && activeTab === "users" && (
          <div>
            {/* User Stats */}
            {userStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("users.total")}</h4>
                  <p className="text-2xl font-bold text-white">{userStats.total}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("users.activeWeek")}</h4>
                  <p className="text-2xl font-bold text-green-400">{userStats.active.last7Days}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("users.withTwitch")}</h4>
                  <p className="text-2xl font-bold text-purple-400">{userStats.connections.twitch}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("users.withBattlenet")}</h4>
                  <p className="text-2xl font-bold text-blue-400">{userStats.connections.battlenet}</p>
                </div>
              </div>
            )}

            {/* Users Table */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("users.discord")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("users.twitch")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("users.battlenet")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("users.lastLogin")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-750">
                      <td className="px-4 py-3 text-white">{user.discord.username}</td>
                      <td className="px-4 py-3 text-gray-300">{user.twitch?.displayName || "-"}</td>
                      <td className="px-4 py-3 text-gray-300">{user.battlenet?.battletag || "-"}</td>
                      <td className="px-4 py-3 text-gray-400 text-sm">{formatDate(user.lastLoginAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleOpenUserPickems(user)} className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
                            View Pickems
                          </button>
                          <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
                            {user.pickemSubmissionCount} {user.pickemSubmissionCount === 1 ? "pickem" : "pickems"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="px-4 py-3 bg-gray-900 flex items-center justify-between">
                <button onClick={() => setUsersPage((p) => Math.max(1, p - 1))} disabled={usersPage === 1} className="px-3 py-1 bg-gray-700 text-white rounded disabled:opacity-50">
                  {t("pagination.previous")}
                </button>
                <span className="text-gray-400">
                  {t("pagination.page")} {usersPage} {t("pagination.of")} {usersTotalPages}
                </span>
                <button
                  onClick={() => setUsersPage((p) => Math.min(usersTotalPages, p + 1))}
                  disabled={usersPage === usersTotalPages}
                  className="px-3 py-1 bg-gray-700 text-white rounded disabled:opacity-50"
                >
                  {t("pagination.next")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Guilds Tab */}
        {!loading && activeTab === "guilds" && (
          <div>
            {/* Trigger Message (reuse from overview) */}
            {triggerMessage && (
              <div className={`rounded-lg p-4 mb-4 ${triggerMessage.type === "success" ? "bg-green-900/50 border border-green-500" : "bg-red-900/50 border border-red-500"}`}>
                <p className={triggerMessage.type === "success" ? "text-green-300" : "text-red-300"}>{triggerMessage.text}</p>
              </div>
            )}

            {/* Guild Stats */}
            {guildStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("guilds.total")}</h4>
                  <p className="text-2xl font-bold text-white">{guildStats.total}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("guilds.currentlyRaiding")}</h4>
                  <p className="text-2xl font-bold text-green-400">{guildStats.currentlyRaiding}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("guilds.horde")}</h4>
                  <p className="text-2xl font-bold text-red-400">{guildStats.factions["Horde"] || 0}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("guilds.alliance")}</h4>
                  <p className="text-2xl font-bold text-blue-400">{guildStats.factions["Alliance"] || 0}</p>
                </div>
              </div>
            )}

            {/* Add Guild Button and Search */}
            <div className="mb-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <button onClick={() => setShowAddGuildModal(true)} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors">
                + Add Guild
              </button>

              {/* Guild Search */}
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  value={guildSearch}
                  onChange={(e) => setGuildSearch(e.target.value)}
                  placeholder="Search by guild name or realm..."
                  className="w-full px-4 py-2 pl-10 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {guildSearch && (
                  <button onClick={() => setGuildSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Guilds Table */}
            <div className="relative">
              {tableLoading && (
                <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center z-10 rounded-lg">
                  <div className="text-amber-400">Loading...</div>
                </div>
              )}
              <div className="bg-gray-800 rounded-xl overflow-x-auto shadow-lg shadow-black/15">
                <table className="w-full min-w-[1150px]">
                  <thead className="bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("guilds.name")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("guilds.realm")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("guilds.faction")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">WCL Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("guilds.status")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("guilds.lastFetched")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {guilds.map((guild) => (
                      <tr key={guild.id} className="hover:bg-gray-750 cursor-pointer" onClick={() => handleGuildClick(guild.id)}>
                        <td className="px-4 py-3 text-white">
                          {guild.name}
                          {guild.parentGuild && <span className="text-gray-500 text-sm ml-2">({guild.parentGuild})</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-300">{guild.realm}</td>
                        <td className="px-4 py-3">
                          <span className={`${guild.faction === "Horde" ? "text-red-400" : "text-blue-400"}`}>{guild.faction || "-"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              guild.wclStatus === "active"
                                ? "bg-green-900 text-green-300"
                                : guild.wclStatus === "not_found"
                                  ? "bg-red-900 text-red-300"
                                  : guild.wclStatus === "unclaimed"
                                    ? "bg-amber-900 text-amber-300"
                                    : "bg-gray-700 text-gray-300"
                            }`}
                          >
                            {(guild.wclStatus || "unknown").replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {guild.isCurrentlyRaiding ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-900/50 text-green-400">{t("guilds.raiding")}</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-700 text-gray-400">{t("guilds.idle")}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-sm">{guild.lastFetched ? formatDate(guild.lastFetched) : "-"}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleQueueRescan(guild.id, guild.name)}
                              className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                              title="Queue for full rescan"
                            >
                              Rescan
                            </button>
                            <button
                              onClick={() => handleQueueRescanDeaths(guild.id, guild.name)}
                              className="px-2 py-1 bg-teal-600 text-white text-xs rounded hover:bg-teal-700"
                              title="Rescan death events"
                            >
                              Deaths
                            </button>
                            <button
                              onClick={() => handleQueueRescanCharacters(guild.id, guild.name)}
                              className="px-2 py-1 bg-cyan-600 text-white text-xs rounded hover:bg-cyan-700"
                              title="Rescan characters"
                            >
                              Chars
                            </button>
                            <button
                              onClick={() => handleQueueBackfillReportCharacters(guild.id, guild.name)}
                              className="px-2 py-1 bg-sky-600 text-white text-xs rounded hover:bg-sky-700"
                              title="Backfill report characters"
                            >
                              Rpt Chars
                            </button>
                            <button
                              onClick={() => handleRecalculateStats(guild.id, guild.name)}
                              className="px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700"
                              title="Recalculate statistics"
                            >
                              Stats
                            </button>
                            <button
                              onClick={() => handleUpdateGuildWorldRanks(guild.id, guild.name)}
                              className="px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700"
                              title="Update world rankings for all raids"
                            >
                              Ranks
                            </button>
                            <button
                              onClick={() => handleDeleteGuildClick(guild.id, guild.name)}
                              className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                              title="Delete guild"
                              disabled={deleteGuildLoading && guildToDelete?.id === guild.id}
                            >
                              {deleteGuildLoading && guildToDelete?.id === guild.id ? "..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                <div className="px-4 py-3 bg-gray-900 flex items-center justify-between">
                  <button
                    onClick={() => setGuildsPage((p) => Math.max(1, p - 1))}
                    disabled={guildsPage === 1}
                    className="px-3 py-1 bg-gray-700 text-white rounded disabled:opacity-50"
                  >
                    {t("pagination.previous")}
                  </button>
                  <span className="text-gray-400">
                    {t("pagination.page")} {guildsPage} {t("pagination.of")} {guildsTotalPages}
                  </span>
                  <button
                    onClick={() => setGuildsPage((p) => Math.min(guildsTotalPages, p + 1))}
                    disabled={guildsPage === guildsTotalPages}
                    className="px-3 py-1 bg-gray-700 text-white rounded disabled:opacity-50"
                  >
                    {t("pagination.next")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Streams Tab */}
        {!loading && activeTab === "streams" && (
          <div>
            {triggerMessage && (
              <div className={`rounded-lg p-4 mb-4 ${triggerMessage.type === "success" ? "bg-green-900/50 border border-green-500" : "bg-red-900/50 border border-red-500"}`}>
                <p className={triggerMessage.type === "success" ? "text-green-300" : "text-red-300"}>{triggerMessage.text}</p>
              </div>
            )}

            {twitchBotStatus && (
              <div className="mb-6 space-y-4">
                <div className="bg-gray-800 rounded-lg p-5 space-y-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-white text-balance">Twitch Bot</h2>
                      <p className="mt-1 text-sm text-gray-400 text-pretty">
                        Bot account, joined chat channels, event publishing, and followed channels for stream discovery.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleConnectTwitchBot}
                        disabled={!twitchBotStatus.enabled || triggerLoading === "twitch-bot-connect"}
                        className="min-h-10 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                      >
                        {twitchBotStatus.connected ? "Reconnect Bot Account" : "Connect Bot Account"}
                      </button>
                      <button
                        onClick={handleVerifyTwitchBot}
                        disabled={!twitchBotStatus.connected || triggerLoading === "twitch-bot-verify"}
                        className="min-h-10 px-3 py-2 bg-gray-700 text-gray-200 text-sm rounded hover:bg-gray-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                      >
                        Verify Bot
                      </button>
                      <button
                        onClick={handleDisconnectTwitchBot}
                        disabled={!twitchBotStatus.connected || triggerLoading === "twitch-bot-disconnect"}
                        className="min-h-10 px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="rounded-lg bg-gray-900/70 p-4">
                      <h4 className="text-gray-400 text-sm">OAuth</h4>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`inline-block h-3 w-3 rounded-full ${twitchBotStatus.enabled ? "bg-green-500" : "bg-red-500"}`} />
                        <span className={`text-lg font-bold ${twitchBotStatus.enabled ? "text-green-400" : "text-red-400"}`}>
                          {twitchBotStatus.enabled ? "Configured" : "Missing"}
                        </span>
                      </div>
                      <p className="mt-2 break-all text-xs text-gray-500">{twitchBotStatus.redirectUri}</p>
                    </div>
                    <div className="rounded-lg bg-gray-900/70 p-4">
                      <h4 className="text-gray-400 text-sm">Bot Account</h4>
                      <p className={`mt-1 text-lg font-bold ${twitchBotStatus.connected ? "text-white" : "text-amber-400"}`}>
                        {twitchBotStatus.twitchDisplayName || twitchBotStatus.twitchLogin || (twitchBotStatus.connected ? "Connected" : "Not connected")}
                      </p>
                      {twitchBotStatus.connectedByUsername && <p className="text-sm text-gray-500">by {twitchBotStatus.connectedByUsername}</p>}
                      {twitchBotStatus.tokenExpiresAt && <p className="text-sm text-gray-500">token: {formatDate(twitchBotStatus.tokenExpiresAt)}</p>}
                      {twitchBotStatus.missingScopes.length > 0 ? (
                        <p className="mt-1 text-xs text-amber-300">Missing scope: {twitchBotStatus.missingScopes.join(", ")}</p>
                      ) : (
                        twitchBotStatus.scopes.length > 0 && <p className="mt-1 break-all text-xs text-gray-500">{twitchBotStatus.scopes.join(", ")}</p>
                      )}
                    </div>
                    <div className="rounded-lg bg-gray-900/70 p-4">
                      <h4 className="text-gray-400 text-sm">Chat</h4>
                      <p className={`mt-1 text-lg font-bold ${twitchBotStatus.chat.connected ? "text-green-400" : "text-amber-400"}`}>
                        {twitchBotStatus.chat.connected ? "Connected" : twitchBotStatus.chat.running ? "Waiting" : "Stopped"}
                      </p>
                      <p className="text-sm text-gray-500 tabular-nums">
                        {twitchBotStatus.chat.joinedCount}/{twitchBotStatus.chat.desiredCount} channels
                      </p>
                      {twitchBotStatus.chat.lastReconciledAt && <p className="text-sm text-gray-500">reconciled: {formatDate(twitchBotStatus.chat.lastReconciledAt)}</p>}
                    </div>
                    <div className="rounded-lg bg-gray-900/70 p-4">
                      <h4 className="text-gray-400 text-sm">Deliveries</h4>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-gray-300 tabular-nums">
                        <div>
                          <span className="block text-amber-300 font-semibold">{twitchBotStatus.deliveries.pending}</span>
                          <span className="text-gray-500">pending</span>
                        </div>
                        <div>
                          <span className="block text-red-300 font-semibold">{twitchBotStatus.deliveries.failed}</span>
                          <span className="text-gray-500">failed</span>
                        </div>
                        <div>
                          <span className="block text-green-300 font-semibold">{twitchBotStatus.deliveries.sent24h}</span>
                          <span className="text-gray-500">24h</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {twitchBotStatus.chat.lastError && (
                    <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">{twitchBotStatus.chat.lastError}</div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {renderTriggerButton("twitch-bot-reconnect", "Reconnect Chat", triggerTwitchBotReconnect, {
                      disabled: !twitchBotStatus.connected,
                    })}
                    {renderTriggerButton("twitch-bot-reconcile", "Reconcile Channels", triggerTwitchBotReconcile, {
                      disabled: !twitchBotStatus.connected,
                    })}
                  </div>

                  {(twitchBotStatus.chat.joinedChannels.length > 0 || twitchBotStatus.chat.desiredChannels.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="rounded-lg bg-gray-900/70 p-4">
                        <h4 className="text-gray-400 mb-2">Joined Channels</h4>
                        <p className="text-gray-200 break-words">
                          {twitchBotStatus.chat.joinedChannels.slice(0, 30).map((channel) => `#${channel}`).join(", ") || "None"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-900/70 p-4">
                        <h4 className="text-gray-400 mb-2">Desired Channels</h4>
                        <p className="text-gray-200 break-words">
                          {twitchBotStatus.chat.desiredChannels.slice(0, 30).map((channel) => `#${channel}`).join(", ") || "None"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {twitchChannelPointsStatus && (
                  <div className="bg-gray-800 rounded-lg p-5 space-y-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-white text-balance">Channel Points CCG Reward</h3>
                        <p className="mt-1 text-sm text-gray-400 text-pretty">
                          The {twitchChannelPointsStatus.expectedBroadcasterLogin} broadcaster authorization listens for one reward. Vaarabot posts the result in chat.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={handleConnectTwitchChannelPoints}
                          disabled={!twitchChannelPointsStatus.enabled || triggerLoading === "twitch-channel-points-connect"}
                          className="min-h-10 px-3 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                        >
                          {twitchChannelPointsStatus.connected ? "Reconnect Broadcaster" : "Connect Broadcaster"}
                        </button>
                        <button
                          onClick={handleVerifyTwitchChannelPoints}
                          disabled={!twitchChannelPointsStatus.connected || triggerLoading === "twitch-channel-points-verify"}
                          className="min-h-10 px-3 py-2 bg-gray-700 text-gray-200 text-sm rounded hover:bg-gray-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                        >
                          Verify
                        </button>
                        <button
                          onClick={handleDisconnectTwitchChannelPoints}
                          disabled={!twitchChannelPointsStatus.connected || triggerLoading === "twitch-channel-points-disconnect"}
                          className="min-h-10 px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div className="rounded-lg bg-gray-900/70 p-4">
                        <h4 className="text-gray-400 text-sm">Broadcaster</h4>
                        <p className={`mt-1 text-lg font-bold ${twitchChannelPointsStatus.connected ? "text-white" : "text-amber-400"}`}>
                          {twitchChannelPointsStatus.broadcasterDisplayName || (twitchChannelPointsStatus.connected ? "Connected" : "Not connected")}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 break-all">{twitchChannelPointsStatus.missingScopes.join(", ") || twitchChannelPointsStatus.scopes.join(", ")}</p>
                      </div>
                      <div className="rounded-lg bg-gray-900/70 p-4">
                        <h4 className="text-gray-400 text-sm">EventSub</h4>
                        <p className={`mt-1 text-lg font-bold ${twitchChannelPointsStatus.subscriptionStatus === "enabled" ? "text-green-400" : "text-amber-400"}`}>
                          {twitchChannelPointsStatus.rewardEnabled ? twitchChannelPointsStatus.subscriptionStatus || "Starting" : "Disabled"}
                        </p>
                        {twitchChannelPointsStatus.lastNotificationAt && <p className="text-xs text-gray-500">last reward: {formatDate(twitchChannelPointsStatus.lastNotificationAt)}</p>}
                      </div>
                      <div className="rounded-lg bg-gray-900/70 p-4">
                        <h4 className="text-gray-400 text-sm">Pack Grants</h4>
                        <p className="mt-1 text-lg font-bold text-green-400 tabular-nums">{twitchChannelPointsStatus.deliveries.grants.granted}</p>
                        <p className="text-xs text-gray-500 tabular-nums">
                          {twitchChannelPointsStatus.deliveries.grants.pending} pending · {twitchChannelPointsStatus.deliveries.grants.failed} failed
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-900/70 p-4">
                        <h4 className="text-gray-400 text-sm">Chat Replies</h4>
                        <p className="mt-1 text-lg font-bold text-green-400 tabular-nums">{twitchChannelPointsStatus.deliveries.chat.sent24h} / 24h</p>
                        <p className="text-xs text-gray-500 tabular-nums">
                          {twitchChannelPointsStatus.deliveries.chat.pending} pending · {twitchChannelPointsStatus.deliveries.chat.failed} failed
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                      <div>
                        <label htmlFor="twitch-channel-points-reward" className="block text-sm font-medium text-gray-200">Reward</label>
                        <select
                          id="twitch-channel-points-reward"
                          value={twitchChannelPointsRewardTitle}
                          onChange={(event) => setTwitchChannelPointsRewardTitle(event.target.value)}
                          disabled={!twitchChannelPointsStatus.connected}
                          className="mt-2 min-h-11 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <option value="">Choose a custom reward</option>
                          {twitchChannelPointRewards.map((reward) => (
                            <option key={reward.id} value={reward.title}>
                              {reward.title} ({reward.cost.toLocaleString()} points){reward.skipsRequestQueue ? "" : " — queue enabled"}
                            </option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs text-amber-300">The selected Twitch reward must have “Skip Reward Requests Queue” enabled.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => refreshTwitchChannelPointRewards().catch((error) => setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to refresh rewards" }))}
                          disabled={!twitchChannelPointsStatus.connected}
                          className="min-h-11 px-3 py-2 bg-gray-700 text-gray-200 text-sm rounded hover:bg-gray-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                        >
                          Refresh Rewards
                        </button>
                        <label className="flex min-h-11 items-center gap-3 rounded bg-gray-900 px-3 py-2 text-sm text-gray-200">
                          <input
                            type="checkbox"
                            checked={twitchChannelPointsEnabled}
                            onChange={(event) => setTwitchChannelPointsEnabled(event.target.checked)}
                            disabled={!twitchChannelPointsStatus.connected}
                            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                          />
                          Enabled
                        </label>
                        <button
                          onClick={handleSaveTwitchChannelPoints}
                          disabled={!twitchChannelPointsStatus.connected || twitchChannelPointsSaving}
                          className="min-h-11 px-4 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                        >
                          {twitchChannelPointsSaving ? "Saving..." : "Save & Subscribe"}
                        </button>
                      </div>
                    </div>

                    {twitchChannelPointsStatus.lastError && (
                      <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">{twitchChannelPointsStatus.lastError}</div>
                    )}
                    <p className="text-xs text-gray-500 break-all">Webhook: {twitchChannelPointsStatus.callbackUrl}</p>
                  </div>
                )}

                <div className="bg-gray-800 rounded-lg p-5 space-y-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-white text-balance">Bot Settings</h3>
                        <p className="mt-1 text-sm text-gray-400 text-pretty">Controls for automated progress messages sent to live raiding streams.</p>
                      </div>
                      <button
                        onClick={handleSaveTwitchBotSettings}
                        disabled={!twitchBotSettingsDraft || !twitchBotSettingsChanged || twitchBotSettingsSaving}
                        className="min-h-10 px-4 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                      >
                        {twitchBotSettingsSaving ? "Saving..." : twitchBotSettingsChanged ? "Save Settings" : "Saved"}
                      </button>
                    </div>

                    {twitchBotSettingsDraft && (
                      <div className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label className="flex min-h-11 items-center justify-between gap-4 rounded-lg bg-gray-900/70 px-4 py-3">
                            <span>
                              <span className="block text-sm font-medium text-white">Event publishing</span>
                              <span className="block text-xs text-gray-500">Send boss kill and progress events to joined Twitch chats.</span>
                            </span>
                            <input
                              type="checkbox"
                              checked={twitchBotSettingsDraft.eventPublishingEnabled}
                              onChange={(event) => setTwitchBotSettingsDraft({ ...twitchBotSettingsDraft, eventPublishingEnabled: event.target.checked })}
                              className="h-5 w-5 rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500"
                            />
                          </label>
                          <label className="flex min-h-11 items-center justify-between gap-4 rounded-lg bg-gray-900/70 px-4 py-3">
                            <span>
                              <span className="block text-sm font-medium text-white">Include URLs</span>
                              <span className="block text-xs text-gray-500">Append SuomiWoW links to bot replies and event messages.</span>
                            </span>
                            <input
                              type="checkbox"
                              checked={twitchBotSettingsDraft.includeUrl}
                              onChange={(event) => setTwitchBotSettingsDraft({ ...twitchBotSettingsDraft, includeUrl: event.target.checked })}
                              className="h-5 w-5 rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="rounded-lg bg-gray-900/70 p-4">
                            <h4 className="text-sm font-medium text-white">Event Types</h4>
                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {TWITCH_BOT_EVENT_TYPE_OPTIONS.map((option) => {
                                const selected = twitchBotSettingsDraft.eventTypes.includes(option.value);
                                return (
                                  <label key={option.value} className="flex min-h-10 items-center gap-3 rounded bg-gray-800 px-3 py-2 text-sm text-gray-200">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      disabled={selected && twitchBotSettingsDraft.eventTypes.length === 1}
                                      onChange={() => toggleTwitchBotEventType(option.value)}
                                      className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-amber-500 focus:ring-amber-500 disabled:opacity-50"
                                    />
                                    <span>{option.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <div className="rounded-lg bg-gray-900/70 p-4">
                            <h4 className="text-sm font-medium text-white">Difficulties</h4>
                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {TWITCH_BOT_DIFFICULTY_OPTIONS.map((option) => {
                                const selected = twitchBotSettingsDraft.difficulties.includes(option.value);
                                return (
                                  <label key={option.value} className="flex min-h-10 items-center gap-3 rounded bg-gray-800 px-3 py-2 text-sm text-gray-200">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      disabled={selected && twitchBotSettingsDraft.difficulties.length === 1}
                                      onChange={() => toggleTwitchBotDifficulty(option.value)}
                                      className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-amber-500 focus:ring-amber-500 disabled:opacity-50"
                                    />
                                    <span>{option.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-lg bg-gray-900/70 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h4 className="text-sm font-medium text-white">Message Templates</h4>
                              <p className="mt-1 text-xs text-gray-500">Templates are saved as one-line Twitch chat messages.</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => resetTwitchBotTemplate(activeTwitchTemplateKey)}
                              className="min-h-9 rounded bg-gray-800 px-3 py-2 text-sm text-gray-200 transition-[background-color,transform] hover:bg-gray-700 active:scale-[0.96]"
                            >
                              Reset {activeTwitchTemplateLabel}
                            </button>
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="tablist" aria-label="Twitch bot message templates">
                            {TWITCH_BOT_TEMPLATE_OPTIONS.map((option) => {
                              const selected = option.key === activeTwitchTemplateKey;
                              return (
                                <button
                                  key={option.key}
                                  type="button"
                                  onClick={() => setActiveTwitchTemplateKey(option.key)}
                                  className={`min-h-10 rounded px-3 py-2 text-sm font-medium transition-[background-color,color,transform] active:scale-[0.96] ${
                                    selected ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
                                  }`}
                                  role="tab"
                                  aria-selected={selected}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>

                          <div className="mt-4">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <label htmlFor={`twitch-template-${activeTwitchTemplateKey}`} className="text-sm font-medium text-gray-200">
                                {activeTwitchTemplateLabel}
                              </label>
                              <span className="text-xs text-gray-500 tabular-nums">
                                {(twitchBotSettingsDraft.messageTemplates[activeTwitchTemplateKey] || "").length}/450
                              </span>
                            </div>
                            <textarea
                              id={`twitch-template-${activeTwitchTemplateKey}`}
                              data-twitch-bot-template={activeTwitchTemplateKey}
                              value={twitchBotSettingsDraft.messageTemplates[activeTwitchTemplateKey] || ""}
                              onFocus={() => setActiveTwitchTemplateKey(activeTwitchTemplateKey)}
                              onChange={(event) => updateTwitchBotTemplate(activeTwitchTemplateKey, event.target.value)}
                              maxLength={450}
                              rows={3}
                              className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition-[border-color,box-shadow] focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
                            />
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {TWITCH_BOT_TEMPLATE_PLACEHOLDERS.map((placeholder) => (
                              <button
                                key={placeholder.token}
                                type="button"
                                onClick={() => insertTwitchBotTemplatePlaceholder(placeholder.token)}
                                title={placeholder.label}
                                className="max-w-full rounded bg-gray-800 px-2.5 py-1.5 font-mono text-xs text-gray-200 transition-[background-color,transform] hover:bg-gray-700 active:scale-[0.96]"
                              >
                                {`{${placeholder.token}}`}
                              </button>
                            ))}
                          </div>

                          <div className="mt-4">
                            <div className="mb-2 text-xs font-medium uppercase text-gray-500">Preview</div>
                            <p className="min-h-10 rounded bg-gray-800 px-3 py-2 text-sm text-gray-200 break-words">
                              {previewTwitchBotTemplate(twitchBotSettingsDraft.messageTemplates[activeTwitchTemplateKey] || "")}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                </div>
              </div>
            )}

            {twitchStreamStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">Tracked Entries</h4>
                  <p className="text-2xl font-bold text-white">{twitchStreamStats.total}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">Unique Channels</h4>
                  <p className="text-2xl font-bold text-purple-400">{twitchStreamStats.uniqueChannels}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">Live Now</h4>
                  <p className="text-2xl font-bold text-green-400">{twitchStreamStats.live}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">Live in WoW</h4>
                  <p className="text-2xl font-bold text-blue-400">{twitchStreamStats.livePlayingWoW}</p>
                </div>
              </div>
            )}

            <div className="mb-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Tracked Twitch Streams</h2>
                <p className="text-sm text-gray-400">
                  Showing {filteredTwitchStreams.length} of {twitchStreams.length} configured streamer entries
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <button
                  onClick={() =>
                    refreshTwitchBotTableData().catch((error) =>
                      setTriggerMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to refresh Twitch bot data" }),
                    )
                  }
                  disabled={!twitchBotStatus?.connected || twitchBotTableDataLoading}
                  className="min-h-10 px-3 py-2 bg-gray-700 text-gray-200 text-sm rounded hover:bg-gray-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                >
                  {twitchBotTableDataLoading ? "Refreshing..." : "Refresh bot data"}
                </button>
                <div className="relative w-full sm:w-80">
                  <input
                    type="text"
                    value={twitchStreamSearch}
                    onChange={(e) => setTwitchStreamSearch(e.target.value)}
                    placeholder="Search channel, guild, realm, or game..."
                    className="w-full px-4 py-2 pl-10 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {twitchStreamSearch && (
                    <button onClick={() => setTwitchStreamSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                      ×
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="relative">
              {tableLoading && (
                <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center z-10 rounded-lg">
                  <div className="text-amber-400">Loading...</div>
                </div>
              )}
              <div className="bg-gray-800 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1220px]">
                    <thead className="bg-gray-900">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Channel</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Game</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Guild</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Bot Follows</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Bot Chat</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Last Checked</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Last Live</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {filteredTwitchStreams.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                            No tracked streams found.
                          </td>
                        </tr>
                      ) : (
                        filteredTwitchStreams.map((stream) => {
                          const statusClass = stream.isLive
                            ? stream.isPlayingWoW
                              ? "bg-green-900/50 text-green-300"
                              : "bg-blue-900/50 text-blue-300"
                            : "bg-gray-700 text-gray-400";
                          const statusLabel = stream.isLive ? (stream.isPlayingWoW ? "Live WoW" : "Live") : "Offline";
                          const botFollows = twitchBotFollows?.hasRequiredScope ? twitchBotFollowedChannels.has(stream.channelName.toLowerCase()) : null;
                          const botChatBan = twitchBotBannedChannels.get(stream.channelName.toLowerCase());
                          const botChatJoined = twitchBotJoinedChannels.has(stream.channelName.toLowerCase());
                          const botChatRetryLabel = botChatBan
                            ? new Date(botChatBan.nextRetryAt).getTime() > Date.now()
                              ? `Retry ${formatDate(botChatBan.nextRetryAt)}`
                              : stream.isLive && stream.isPlayingWoW && stream.guild.isCurrentlyRaiding
                                ? "Retry pending"
                                : "Retry when live"
                            : null;

                          return (
                            <tr key={`${stream.guild.id}-${stream.channelName}`} className="hover:bg-gray-750">
                              <td className="px-4 py-3">
                                <a href={stream.twitchUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-purple-300 hover:text-purple-200 underline">
                                  {stream.channelName}
                                </a>
                                {stream.twitchUserId && <div className="text-xs text-gray-500">ID: {stream.twitchUserId}</div>}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusClass}`}>{statusLabel}</span>
                              </td>
                              <td className="px-4 py-3 text-gray-300">{stream.gameName || "-"}</td>
                              <td className="px-4 py-3">
                                <button onClick={() => handleGuildClick(stream.guild.id)} className="text-left text-amber-400 hover:text-amber-300">
                                  {stream.guild.name}
                                  {stream.guild.parentGuild && <span className="text-gray-500 text-sm ml-2">({stream.guild.parentGuild})</span>}
                                </button>
                                <div className="text-xs text-gray-500">
                                  {stream.guild.realm} - {stream.guild.region.toUpperCase()}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {stream.guild.isCurrentlyRaiding && <span className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 text-[10px] uppercase">Raiding</span>}
                                  {stream.guild.activityStatus === "inactive" && <span className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 text-[10px] uppercase">Inactive</span>}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  title={botFollows === null ? "Follow status is unavailable." : undefined}
                                  className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                    botFollows === null ? "bg-gray-700 text-gray-400" : botFollows ? "bg-green-900/50 text-green-300" : "bg-amber-900/40 text-amber-300"
                                  }`}
                                >
                                  {botFollows === null ? "Unknown" : botFollows ? "Yes" : "No"}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {botChatBan ? (
                                  <div>
                                    <span
                                      title={`Detected ${formatDate(botChatBan.detectedAt)}; observed ${botChatBan.failureCount} ${botChatBan.failureCount === 1 ? "time" : "times"}.`}
                                      className="inline-flex items-center rounded-full bg-red-900/50 px-2 py-1 text-xs font-medium text-red-300"
                                    >
                                      Banned
                                    </span>
                                    <div className="mt-1 text-xs text-gray-500 tabular-nums">{botChatRetryLabel}</div>
                                  </div>
                                ) : botChatJoined ? (
                                  <span className="inline-flex items-center rounded-full bg-green-900/50 px-2 py-1 text-xs font-medium text-green-300">Joined</span>
                                ) : (
                                  <span
                                    title="The bot only checks chat access while a tracked raid stream is live in WoW."
                                    className="text-xs text-gray-500"
                                  >
                                    {twitchBotStatus?.chat.connected ? "Not checked" : "Bot offline"}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-gray-400 text-sm">{stream.lastChecked ? formatDate(stream.lastChecked) : "-"}</td>
                              <td className="px-4 py-3 text-gray-400 text-sm">{stream.lastLiveAt ? formatDate(stream.lastLiveAt) : "-"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Characters Tab */}
        {!loading && activeTab === "characters" && (
          <div>
            {/* Character Stats */}
            {characterStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("characters.total")}</h4>
                  <p className="text-2xl font-bold text-white">{characterStats.total.toLocaleString()}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("characters.withRankings")}</h4>
                  <p className="text-2xl font-bold text-green-400">{characterStats.withRankings.toLocaleString()}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("characters.recentlyActive")}</h4>
                  <p className="text-2xl font-bold text-blue-400">{characterStats.recentlyActive.toLocaleString()}</p>
                </div>
              </div>
            )}

            {/* Delete Rankings by Raid & Partition */}
            <div className="bg-gray-800 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <span>🗑️</span> Delete Rankings by Raid &amp; Partition
              </h3>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Raid</label>
                  <select
                    value={deleteRankingsRaidId}
                    onChange={(e) => {
                      setDeleteRankingsRaidId(e.target.value);
                      setDeleteRankingsPartition("");
                      setDeleteRankingsPreview(null);
                      setShowDeleteRankingsConfirm(false);
                    }}
                    className="bg-gray-700 text-white rounded-lg px-3 py-2 min-w-60"
                  >
                    <option value="">Select raid...</option>
                    {adminRaids.map((raid) => (
                      <option key={raid.id} value={raid.id}>
                        {raid.name} {raid.isPrimary ? "(Primary)" : raid.isCurrent ? "(Current)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Partition</label>
                  <select
                    value={deleteRankingsPartition}
                    onChange={(e) => {
                      setDeleteRankingsPartition(e.target.value);
                      setDeleteRankingsPreview(null);
                      setShowDeleteRankingsConfirm(false);
                    }}
                    disabled={!deleteRankingsRaidId}
                    className="bg-gray-700 text-white rounded-lg px-3 py-2 min-w-[200px] disabled:opacity-50"
                  >
                    <option value="">Select partition...</option>
                    {deleteRankingsRaidId &&
                      adminRaids
                        .find((r) => r.id === Number(deleteRankingsRaidId))
                        ?.partitions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                  </select>
                </div>
                <button
                  onClick={async () => {
                    if (!deleteRankingsRaidId || !deleteRankingsPartition) return;
                    setDeleteRankingsLoading(true);
                    try {
                      const preview = await api.getAdminCharacterRankingsDeletePreview(Number(deleteRankingsRaidId), Number(deleteRankingsPartition));
                      setDeleteRankingsPreview(preview);
                      setShowDeleteRankingsConfirm(false);
                    } catch (error) {
                      setTriggerMessage({
                        type: "error",
                        text: error instanceof Error ? error.message : "Failed to load preview",
                      });
                    } finally {
                      setDeleteRankingsLoading(false);
                    }
                  }}
                  disabled={!deleteRankingsRaidId || !deleteRankingsPartition || deleteRankingsLoading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {deleteRankingsLoading ? "Loading..." : "Preview"}
                </button>
              </div>

              {/* Preview Results */}
              {deleteRankingsPreview && (
                <div className="mt-4 bg-gray-900 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-3">
                    {deleteRankingsPreview.raid.name} — {deleteRankingsPreview.partition.name}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div className="bg-gray-800 rounded p-3">
                      <span className="text-gray-400 text-sm">Raw Rankings</span>
                      <p className="text-xl font-bold text-red-400">{deleteRankingsPreview.willBeDeleted.rankings.toLocaleString()}</p>
                    </div>
                    <div className="bg-gray-800 rounded p-3">
                      <span className="text-gray-400 text-sm">Leaderboard (Partition)</span>
                      <p className="text-xl font-bold text-red-400">{deleteRankingsPreview.willBeDeleted.leaderboardEntries.toLocaleString()}</p>
                    </div>
                    <div className="bg-gray-800 rounded p-3">
                      <span className="text-gray-400 text-sm">Leaderboard (All Partitions)</span>
                      <p className="text-xl font-bold text-amber-400">{deleteRankingsPreview.willBeDeleted.leaderboardAllPartitionsEntries.toLocaleString()}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">
                    Total: <span className="text-white font-bold">{deleteRankingsPreview.totalDocuments.toLocaleString()}</span> documents will be deleted. All-partitions
                    leaderboard entries will be rebuilt on next nightly cycle.
                  </p>

                  {!showDeleteRankingsConfirm ? (
                    <button
                      onClick={() => setShowDeleteRankingsConfirm(true)}
                      disabled={deleteRankingsPreview.totalDocuments === 0}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                      Delete Rankings
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-red-400 font-medium">Are you sure?</span>
                      <button
                        onClick={async () => {
                          setDeleteRankingsLoading(true);
                          try {
                            const result = await api.deleteAdminCharacterRankings(Number(deleteRankingsRaidId), Number(deleteRankingsPartition));
                            setTriggerMessage({ type: "success", text: result.message });
                            setDeleteRankingsPreview(null);
                            setShowDeleteRankingsConfirm(false);
                            setDeleteRankingsRaidId("");
                            setDeleteRankingsPartition("");
                            // Refresh character stats
                            const charStatsData = await api.getAdminCharacterStats();
                            setCharacterStats(charStatsData);
                          } catch (error) {
                            setTriggerMessage({
                              type: "error",
                              text: error instanceof Error ? error.message : "Failed to delete rankings",
                            });
                          } finally {
                            setDeleteRankingsLoading(false);
                          }
                        }}
                        disabled={deleteRankingsLoading}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                      >
                        {deleteRankingsLoading ? "Deleting..." : "Yes, Delete"}
                      </button>
                      <button
                        onClick={() => setShowDeleteRankingsConfirm(false)}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Search + Refresh Rankings Button */}
            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                placeholder={t("characters.searchPlaceholder")}
                value={characterSearch}
                onChange={(e) => setCharacterSearch(e.target.value)}
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={async () => {
                  setTriggerLoading("refreshCharacterRankings");
                  try {
                    const result = await triggerRefreshCharacterRankings();
                    setTriggerMessage({
                      type: result.success ? "success" : "error",
                      text: result.message,
                    });
                  } catch (error) {
                    setTriggerMessage({
                      type: "error",
                      text: error instanceof Error ? error.message : "Failed to trigger",
                    });
                  } finally {
                    setTriggerLoading(null);
                  }
                }}
                disabled={triggerLoading === "refreshCharacterRankings"}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {triggerLoading === "refreshCharacterRankings" ? "..." : t("characters.refreshRankings")}
              </button>
            </div>

            {/* Characters Table */}
            <div className="relative">
              {tableLoading && (
                <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center z-10 rounded-lg">
                  <div className="text-amber-400">Loading...</div>
                </div>
              )}
              <div className="bg-gray-800 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("characters.name")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("characters.class")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("characters.realm")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("characters.region")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("characters.blizzardIdentity")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("characters.lastSeen")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("characters.rankings")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("characters.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {characters.map((char) => {
                      const isEditingIdentity = editingBlizzardIdentity?.characterId === char.id;
                      const isEditingLink = editingIdentityLink?.characterId === char.id;
                      const isEditingAccountLink = editingAccountLink?.characterId === char.id;
                      const isSavingIdentity = blizzardIdentitySavingId === char.id;

                      return (
                        <Fragment key={char.id}>
                          <tr className="hover:bg-gray-750">
                            <td className="px-4 py-3 text-white font-medium">
                              <div>{char.name}</div>
                              {char.identityLinks.length > 0 && (
                                <div className="mt-0.5 text-xs font-normal text-blue-300 tabular-nums">
                                  {t("characters.linkedAliasCount", { count: char.identityLinks.length })}
                                </div>
                              )}
                              {char.accountLinks.length > 0 && (
                                <div className="mt-0.5 text-xs font-normal text-violet-300 tabular-nums">
                                  {t("characters.manualAccountLinkCount", { count: char.accountLinks.length })}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-300">{char.className}</td>
                            <td className="px-4 py-3 text-gray-300">{char.realm}</td>
                            <td className="px-4 py-3 text-gray-300 uppercase">{char.region}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-white">{char.blizzardIdentity.name}</span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-xs ${
                                    char.blizzardIdentityOverride?.active
                                      ? "bg-amber-500/15 text-amber-300"
                                      : char.blizzardIdentityOverride
                                        ? "bg-blue-500/15 text-blue-300"
                                        : "bg-gray-700 text-gray-400"
                                  }`}
                                >
                                  {char.blizzardIdentityOverride?.active
                                    ? t("characters.identityManual")
                                    : char.blizzardIdentityOverride
                                      ? t("characters.identitySuperseded")
                                      : t("characters.identityAutomatic")}
                                </span>
                              </div>
                              <div className="mt-0.5 text-xs text-gray-400">{char.blizzardIdentity.realm}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-sm">{char.lastMythicSeenAt ? new Date(char.lastMythicSeenAt).toLocaleDateString() : "—"}</td>
                            <td className="px-4 py-3">
                              {char.rankingsAvailable === true && <span className="px-2 py-0.5 text-xs rounded-full bg-green-900/30 text-green-400">{t("characters.available")}</span>}
                              {char.rankingsAvailable === false && <span className="px-2 py-0.5 text-xs rounded-full bg-red-900/30 text-red-400">{t("characters.unavailable")}</span>}
                              {char.rankingsAvailable === null && <span className="px-2 py-0.5 text-xs rounded-full bg-gray-700 text-gray-400">{t("characters.unknown")}</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => {
                                    setEditingIdentityLink(null);
                                    setIdentityLinkPreview(null);
                                    setEditingAccountLink(null);
                                    setAccountLinkPreview(null);
                                    setEditingBlizzardIdentity({
                                      characterId: char.id,
                                      name: char.blizzardIdentity.name,
                                      realm: char.blizzardIdentity.realm,
                                    });
                                  }}
                                  aria-expanded={isEditingIdentity}
                                  className="min-h-10 rounded-lg bg-gray-700 px-3 text-xs font-medium text-white transition-colors hover:bg-gray-600 active:scale-[0.96]"
                                >
                                  {t("characters.identityEdit")}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingBlizzardIdentity(null);
                                    setEditingAccountLink(null);
                                    setAccountLinkPreview(null);
                                    setIdentityLinkPreview(null);
                                    setEditingIdentityLink({
                                      characterId: char.id,
                                      name: "",
                                      realm: "",
                                      region: char.region.toLowerCase(),
                                      classID: char.classID,
                                    });
                                  }}
                                  aria-expanded={isEditingLink}
                                  className="min-h-10 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-700 active:scale-[0.96]"
                                >
                                  {t("characters.linkAlias")}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingBlizzardIdentity(null);
                                    setEditingIdentityLink(null);
                                    setIdentityLinkPreview(null);
                                    setAccountLinkPreview(null);
                                    setEditingAccountLink({
                                      characterId: char.id,
                                      name: "",
                                      realm: "",
                                      region: char.region.toLowerCase(),
                                    });
                                  }}
                                  aria-expanded={isEditingAccountLink}
                                  className="min-h-10 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white transition-[scale,background-color] duration-150 ease-out hover:bg-violet-700 active:scale-[0.96]"
                                >
                                  {t("characters.accountLink")}
                                </button>
                                <button
                                  onClick={() => handleDeleteCharacterClick(char.id, char.name, char.realm)}
                                  className="min-h-10 rounded-lg bg-red-600 px-3 text-xs font-medium text-white transition-colors hover:bg-red-700 active:scale-[0.96]"
                                  title={t("characters.deleteTitle")}
                                >
                                  {t("characters.delete")}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isEditingIdentity && editingBlizzardIdentity && (
                            <tr className="bg-gray-900/70">
                              <td colSpan={8} className="px-4 py-4">
                                <div className="rounded-xl border border-amber-500/25 bg-gray-900 p-4 shadow-md shadow-black/15">
                                  <div className="mb-4">
                                    <h4 className="font-semibold text-white">{t("characters.identityEditorTitle")}</h4>
                                    <p className="mt-1 max-w-3xl text-sm text-gray-400 text-pretty">{t("characters.identityEditorDescription")}</p>
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_auto] md:items-end">
                                    <label className="block text-sm text-gray-300">
                                      <span className="mb-1.5 block">{t("characters.identityName")}</span>
                                      <input
                                        value={editingBlizzardIdentity.name}
                                        onChange={(event) => setEditingBlizzardIdentity({ ...editingBlizzardIdentity, name: event.target.value })}
                                        className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-white outline-none transition-colors focus:border-amber-500"
                                        autoComplete="off"
                                      />
                                    </label>
                                    <label className="block text-sm text-gray-300">
                                      <span className="mb-1.5 block">{t("characters.identityRealm")}</span>
                                      <input
                                        value={editingBlizzardIdentity.realm}
                                        onChange={(event) => setEditingBlizzardIdentity({ ...editingBlizzardIdentity, realm: event.target.value })}
                                        className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-white outline-none transition-colors focus:border-amber-500"
                                        autoComplete="off"
                                      />
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        onClick={handleSaveBlizzardIdentity}
                                        disabled={isSavingIdentity || !editingBlizzardIdentity.name.trim() || !editingBlizzardIdentity.realm.trim()}
                                        className="min-h-10 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {isSavingIdentity ? t("characters.identitySaving") : t("characters.identitySave")}
                                      </button>
                                      <button
                                        onClick={() => setEditingBlizzardIdentity(null)}
                                        disabled={isSavingIdentity}
                                        className="min-h-10 rounded-lg bg-gray-700 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-600 active:scale-[0.96] disabled:opacity-50"
                                      >
                                        {t("characters.identityCancel")}
                                      </button>
                                      {char.blizzardIdentityOverride && (
                                        <button
                                          onClick={() => handleClearBlizzardIdentity(char)}
                                          disabled={isSavingIdentity}
                                          className="min-h-10 rounded-lg px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 active:scale-[0.96] disabled:opacity-50"
                                        >
                                          {t("characters.identityClear")}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {char.blizzardIdentityOverride && (
                                    <p className="mt-3 text-xs text-gray-500">
                                      {t("characters.identityUpdated", {
                                        user: char.blizzardIdentityOverride.updatedBy,
                                        date: new Date(char.blizzardIdentityOverride.updatedAt).toLocaleString(),
                                      })}
                                    </p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          {isEditingLink && editingIdentityLink && (
                            <tr className="bg-gray-900/70">
                              <td colSpan={8} className="px-4 py-4">
                                <div className="rounded-xl border border-blue-500/25 bg-gray-900 p-4 shadow-md shadow-black/15">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <h4 className="font-semibold text-white text-balance">{t("characters.linkEditorTitle")}</h4>
                                      <p className="mt-1 max-w-3xl text-sm text-gray-400 text-pretty">{t("characters.linkEditorDescription")}</p>
                                    </div>
                                    <div className="rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
                                      {t("characters.linkTarget")}: <span className="font-semibold">{char.name}-{char.realm}</span>
                                    </div>
                                  </div>

                                  {char.identityLinks.length > 0 && (
                                    <div className="mt-4 rounded-lg bg-gray-800/70 p-3">
                                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{t("characters.linkExisting")}</div>
                                      <div className="flex flex-wrap gap-2">
                                        {char.identityLinks.map((link) => {
                                          const alias = `${link.sourceName}-${link.sourceRealm}`;
                                          return (
                                            <div key={link.id} className="flex min-h-10 items-center gap-2 rounded-lg bg-gray-800 pl-3 shadow-sm shadow-black/10">
                                              <span className="text-sm text-gray-200">{alias}</span>
                                              <button
                                                onClick={() => handleRemoveIdentityLink(char, link.id, alias)}
                                                disabled={identityLinkLoading}
                                                className="min-h-10 rounded-r-lg px-3 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 active:scale-[0.96] disabled:opacity-50"
                                              >
                                                {t("characters.linkRemove")}
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(160px,1fr)_minmax(190px,1fr)_120px_auto] md:items-end">
                                    <label className="block text-sm text-gray-300">
                                      <span className="mb-1.5 block">{t("characters.linkSourceName")}</span>
                                      <input
                                        value={editingIdentityLink.name}
                                        onChange={(event) => {
                                          setEditingIdentityLink({ ...editingIdentityLink, name: event.target.value });
                                          setIdentityLinkPreview(null);
                                        }}
                                        className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-white outline-none transition-colors focus:border-blue-500"
                                        autoComplete="off"
                                      />
                                    </label>
                                    <label className="block text-sm text-gray-300">
                                      <span className="mb-1.5 block">{t("characters.linkSourceRealm")}</span>
                                      <input
                                        value={editingIdentityLink.realm}
                                        onChange={(event) => {
                                          setEditingIdentityLink({ ...editingIdentityLink, realm: event.target.value });
                                          setIdentityLinkPreview(null);
                                        }}
                                        className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-white outline-none transition-colors focus:border-blue-500"
                                        autoComplete="off"
                                      />
                                    </label>
                                    <label className="block text-sm text-gray-300">
                                      <span className="mb-1.5 block">{t("characters.linkSourceRegion")}</span>
                                      <input
                                        value={editingIdentityLink.region}
                                        onChange={(event) => {
                                          setEditingIdentityLink({ ...editingIdentityLink, region: event.target.value });
                                          setIdentityLinkPreview(null);
                                        }}
                                        className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 uppercase text-white outline-none transition-colors focus:border-blue-500"
                                        autoComplete="off"
                                      />
                                    </label>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={handlePreviewIdentityLink}
                                        disabled={identityLinkLoading || !editingIdentityLink.name.trim() || !editingIdentityLink.realm.trim() || !editingIdentityLink.region.trim()}
                                        className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {identityLinkLoading ? t("characters.linkWorking") : t("characters.linkPreview")}
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingIdentityLink(null);
                                          setIdentityLinkPreview(null);
                                        }}
                                        disabled={identityLinkLoading}
                                        className="min-h-10 rounded-lg bg-gray-700 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-600 active:scale-[0.96] disabled:opacity-50"
                                      >
                                        {t("characters.identityCancel")}
                                      </button>
                                    </div>
                                  </div>

                                  {identityLinkPreview && (
                                    <div className={`mt-4 rounded-lg p-4 ${identityLinkPreview.eligible ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                        <div>
                                          <div className="text-xs text-gray-400">{t("characters.linkAppearances")}</div>
                                          <div className="mt-0.5 text-lg font-semibold text-white tabular-nums">{identityLinkPreview.impact.appearanceCount}</div>
                                        </div>
                                        <div>
                                          <div className="text-xs text-gray-400">{t("characters.linkRaids")}</div>
                                          <div className="mt-0.5 text-lg font-semibold text-white tabular-nums">{identityLinkPreview.impact.raidCount}</div>
                                        </div>
                                        <div>
                                          <div className="text-xs text-gray-400">{t("characters.linkGuilds")}</div>
                                          <div className="mt-0.5 text-lg font-semibold text-white tabular-nums">{identityLinkPreview.impact.guildCount}</div>
                                        </div>
                                        <div>
                                          <div className="text-xs text-gray-400">{t("characters.linkDateRange")}</div>
                                          <div className="mt-1 text-xs text-gray-200 tabular-nums">
                                            {identityLinkPreview.impact.firstSeenAt && identityLinkPreview.impact.lastSeenAt
                                              ? `${new Date(identityLinkPreview.impact.firstSeenAt).toLocaleDateString()} – ${new Date(identityLinkPreview.impact.lastSeenAt).toLocaleDateString()}`
                                              : "—"}
                                          </div>
                                        </div>
                                      </div>
                                      {identityLinkPreview.blockers.length > 0 && (
                                        <ul className="mt-3 space-y-1 text-sm text-red-300">
                                          {identityLinkPreview.blockers.map((blocker) => (
                                            <li key={blocker}>• {t(`characters.linkBlockers.${blocker}`)}</li>
                                          ))}
                                        </ul>
                                      )}
                                      {identityLinkPreview.eligible && (
                                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                          <p className="max-w-2xl text-sm text-emerald-200 text-pretty">
                                            {t("characters.linkPreviewReady", {
                                              source: `${identityLinkPreview.source.name}-${identityLinkPreview.source.realm}`,
                                              target: `${identityLinkPreview.target.name}-${identityLinkPreview.target.realm}`,
                                            })}
                                          </p>
                                          <button
                                            onClick={handleCreateIdentityLink}
                                            disabled={identityLinkLoading}
                                            className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-[0.96] disabled:opacity-50"
                                          >
                                            {identityLinkLoading ? t("characters.linkRebuilding") : t("characters.linkConfirm")}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          {isEditingAccountLink && editingAccountLink && (
                            <tr className="bg-gray-900/70">
                              <td colSpan={8} className="px-4 py-4">
                                <div className="rounded-2xl bg-gray-900 p-4 shadow-[0_0_0_1px_rgba(139,92,246,0.25),0_8px_24px_rgba(0,0,0,0.18)]">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <h4 className="font-semibold text-white text-balance">{t("characters.accountLinkEditorTitle")}</h4>
                                      <p className="mt-1 max-w-3xl text-sm text-gray-400 text-pretty">{t("characters.accountLinkEditorDescription")}</p>
                                    </div>
                                    <div className="rounded-lg bg-violet-500/10 px-3 py-2 text-sm text-violet-200">
                                      {t("characters.accountLinkFirstCharacter")}: <span className="font-semibold">{char.name}-{char.realm}</span>
                                    </div>
                                  </div>

                                  {char.accountLinks.length > 0 && (
                                    <div className="mt-4 rounded-xl bg-gray-800/70 p-3 shadow-sm shadow-black/10">
                                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{t("characters.accountLinkExisting")}</div>
                                      <div className="flex flex-wrap gap-2">
                                        {char.accountLinks.map((link) => {
                                          const otherLabel = `${link.character.name}-${link.character.realm}`;
                                          return (
                                            <div key={link.id} className="flex min-h-10 items-center rounded-lg bg-gray-800 pl-3 shadow-sm shadow-black/10">
                                              <span className="text-sm text-gray-200">{otherLabel}</span>
                                              <button
                                                onClick={() => handleRemoveAccountLink(char, link.id, otherLabel)}
                                                disabled={accountLinkLoading}
                                                className="ml-2 min-h-10 rounded-r-lg px-3 text-xs font-medium text-red-300 transition-[scale,background-color] duration-150 ease-out hover:bg-red-500/10 active:scale-[0.96] disabled:opacity-50"
                                              >
                                                {t("characters.accountLinkRemove")}
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(160px,1fr)_minmax(190px,1fr)_120px_auto] md:items-end">
                                    <label className="block text-sm text-gray-300">
                                      <span className="mb-1.5 block">{t("characters.accountLinkOtherName")}</span>
                                      <input
                                        value={editingAccountLink.name}
                                        onChange={(event) => {
                                          setEditingAccountLink({ ...editingAccountLink, name: event.target.value });
                                          setAccountLinkPreview(null);
                                        }}
                                        className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-white outline-none transition-colors focus:border-violet-500"
                                        autoComplete="off"
                                      />
                                    </label>
                                    <label className="block text-sm text-gray-300">
                                      <span className="mb-1.5 block">{t("characters.accountLinkOtherRealm")}</span>
                                      <input
                                        value={editingAccountLink.realm}
                                        onChange={(event) => {
                                          setEditingAccountLink({ ...editingAccountLink, realm: event.target.value });
                                          setAccountLinkPreview(null);
                                        }}
                                        className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-white outline-none transition-colors focus:border-violet-500"
                                        autoComplete="off"
                                      />
                                    </label>
                                    <label className="block text-sm text-gray-300">
                                      <span className="mb-1.5 block">{t("characters.accountLinkOtherRegion")}</span>
                                      <input
                                        value={editingAccountLink.region}
                                        onChange={(event) => {
                                          setEditingAccountLink({ ...editingAccountLink, region: event.target.value });
                                          setAccountLinkPreview(null);
                                        }}
                                        className="min-h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 uppercase text-white outline-none transition-colors focus:border-violet-500"
                                        autoComplete="off"
                                      />
                                    </label>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={handlePreviewAccountLink}
                                        disabled={accountLinkLoading || !editingAccountLink.name.trim() || !editingAccountLink.realm.trim() || !editingAccountLink.region.trim()}
                                        className="min-h-10 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white transition-[scale,background-color] duration-150 ease-out hover:bg-violet-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {accountLinkLoading ? t("characters.accountLinkWorking") : t("characters.accountLinkPreview")}
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingAccountLink(null);
                                          setAccountLinkPreview(null);
                                        }}
                                        disabled={accountLinkLoading}
                                        className="min-h-10 rounded-lg bg-gray-700 px-3 text-sm font-medium text-white transition-[scale,background-color] duration-150 ease-out hover:bg-gray-600 active:scale-[0.96] disabled:opacity-50"
                                      >
                                        {t("characters.identityCancel")}
                                      </button>
                                    </div>
                                  </div>

                                  {accountLinkPreview && (
                                    <div className={`mt-4 rounded-xl p-4 shadow-sm shadow-black/10 ${accountLinkPreview.eligible ? "bg-violet-500/10" : "bg-red-500/10"}`}>
                                      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                                        <div>
                                          <div className="text-xs text-gray-400">{t("characters.accountLinkCurrentGroups")}</div>
                                          <div className="mt-0.5 text-lg font-semibold text-white tabular-nums">{accountLinkPreview.impact.currentGroupCount}</div>
                                        </div>
                                        <div>
                                          <div className="text-xs text-gray-400">{t("characters.accountLinkMergedCharacters")}</div>
                                          <div className="mt-0.5 text-lg font-semibold text-white tabular-nums">{accountLinkPreview.impact.mergedCharacterCount}</div>
                                        </div>
                                      </div>
                                      <div className="mt-3">
                                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{t("characters.accountLinkAffectedCharacters")}</div>
                                        <div className="flex flex-wrap gap-2">
                                          {accountLinkPreview.impact.members.map((member) => (
                                            <span key={member.id} className="rounded-lg bg-gray-900/70 px-3 py-2 text-sm text-gray-200 shadow-sm shadow-black/10">
                                              {member.name}-{member.realm} <span className="uppercase text-gray-500">{member.region}</span>
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                      {accountLinkPreview.blockers.length > 0 && (
                                        <ul className="mt-3 space-y-1 text-sm text-red-300 text-pretty">
                                          {accountLinkPreview.blockers.map((blocker) => (
                                            <li key={blocker}>• {t(`characters.accountLinkBlockers.${blocker}`)}</li>
                                          ))}
                                        </ul>
                                      )}
                                      {accountLinkPreview.eligible && (
                                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                          <p className="max-w-2xl text-sm text-violet-200 text-pretty">
                                            {accountLinkPreview.impact.alreadyGrouped
                                              ? t("characters.accountLinkAlreadyGrouped", {
                                                  first: `${accountLinkPreview.target.name}-${accountLinkPreview.target.realm}`,
                                                  second: `${accountLinkPreview.other.name}-${accountLinkPreview.other.realm}`,
                                                })
                                              : t("characters.accountLinkPreviewReady", {
                                                  first: `${accountLinkPreview.target.name}-${accountLinkPreview.target.realm}`,
                                                  second: `${accountLinkPreview.other.name}-${accountLinkPreview.other.realm}`,
                                                  count: accountLinkPreview.impact.mergedCharacterCount,
                                                })}
                                          </p>
                                          <button
                                            onClick={handleCreateAccountLink}
                                            disabled={accountLinkLoading}
                                            className="min-h-10 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white transition-[scale,background-color] duration-150 ease-out hover:bg-violet-700 active:scale-[0.96] disabled:opacity-50"
                                          >
                                            {accountLinkLoading ? t("characters.accountLinkRebuilding") : t("characters.accountLinkConfirm")}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination */}
                <div className="px-4 py-3 bg-gray-900 flex items-center justify-between">
                  <button
                    onClick={() => setCharactersPage((p) => Math.max(1, p - 1))}
                    disabled={charactersPage === 1}
                    className="px-3 py-1 bg-gray-700 text-white rounded disabled:opacity-50"
                  >
                    {t("pagination.previous")}
                  </button>
                  <span className="text-gray-400">
                    {t("pagination.page")} {charactersPage} {t("pagination.of")} {charactersTotalPages}
                  </span>
                  <button
                    onClick={() => setCharactersPage((p) => Math.min(charactersTotalPages, p + 1))}
                    disabled={charactersPage === charactersTotalPages}
                    className="px-3 py-1 bg-gray-700 text-white rounded disabled:opacity-50"
                  >
                    {t("pagination.next")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pickems Tab */}
        {!loading && activeTab === "pickems" && (
          <div>
            {/* Pickem Stats */}
            {pickemStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("pickems.total")}</h4>
                  <p className="text-2xl font-bold text-white">{pickemStats.total}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("pickems.active")}</h4>
                  <p className="text-2xl font-bold text-green-400">{pickemStats.active}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("pickems.votingOpen")}</h4>
                  <p className="text-2xl font-bold text-amber-400">{pickemStats.votingOpen}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("pickems.participants")}</h4>
                  <p className="text-2xl font-bold text-blue-400">{pickemStats.totalParticipants}</p>
                </div>
              </div>
            )}

            {/* Create/Edit Button */}
            <div className="mb-4">
              <button
                onClick={() => {
                  setEditingPickem(null);
                  setPickemForm({
                    pickemId: "",
                    name: "",
                    type: "regular",
                    raidIds: [],
                    guildCount: 10,
                    finalRankingsCount: 0,
                    scoreOutOfRangeGuilds: false,
                    votingStart: "",
                    votingEnd: "",
                    active: true,
                    scoringConfig: {
                      exactMatch: 10,
                      offByOne: 8,
                      offByTwo: 6,
                      offByThree: 4,
                      offByFour: 2,
                      offByFiveOrMore: 0,
                    },
                    streakConfig: {
                      enabled: true,
                      minLength: 2,
                      bonusPerGuild: 3,
                    },
                    prizeConfig: {
                      enabled: false,
                      goldPool: 0,
                      distribution: [] as { place: number; percentage: number }[],
                      description: "",
                    },
                  });
                  setShowPickemForm(true);
                }}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                + {t("pickems.create")}
              </button>
            </div>

            {/* Pickem Form Modal */}
            {showPickemForm && (
              <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                  <h3 className="text-xl font-bold text-white mb-4">{editingPickem ? t("pickems.edit") : t("pickems.create")}</h3>

                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        if (editingPickem) {
                          await api.updateAdminPickem(editingPickem.pickemId, {
                            name: pickemForm.name,
                            type: pickemForm.type,
                            raidIds: pickemForm.type === "regular" ? pickemForm.raidIds : [],
                            guildCount: pickemForm.guildCount,
                            finalRankingsCount: pickemForm.finalRankingsCount,
                            scoreOutOfRangeGuilds: pickemForm.type === "regular" ? pickemForm.scoreOutOfRangeGuilds : false,
                            votingStart: pickemForm.votingStart,
                            votingEnd: pickemForm.votingEnd,
                            active: pickemForm.active,
                            scoringConfig: pickemForm.scoringConfig,
                            streakConfig: pickemForm.streakConfig,
                            prizeConfig: pickemForm.prizeConfig,
                          });
                        } else {
                          await api.createAdminPickem({
                            ...pickemForm,
                            raidIds: pickemForm.type === "regular" ? pickemForm.raidIds : [],
                          });
                        }
                        setShowPickemForm(false);
                        // Refresh pickems
                        const pickemsData = await api.getAdminPickems();
                        setPickems(pickemsData.pickems);
                        setPickemStats(pickemsData.stats);
                      } catch (err: unknown) {
                        setError(err instanceof Error ? err.message : "Failed to save pickem");
                      }
                    }}
                    className="space-y-4"
                  >
                    {/* Pickem ID (only for create) */}
                    {!editingPickem && (
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">{t("pickems.form.id")}</label>
                        <input
                          type="text"
                          value={pickemForm.pickemId}
                          onChange={(e) => setPickemForm({ ...pickemForm, pickemId: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                          placeholder="season-one"
                          required
                        />
                        <p className="text-xs text-gray-500 mt-1">{t("pickems.form.idHelp")}</p>
                      </div>
                    )}

                    {/* Name */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">{t("pickems.form.name")}</label>
                      <input
                        type="text"
                        value={pickemForm.name}
                        onChange={(e) => setPickemForm({ ...pickemForm, name: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                          placeholder="Season One"
                        required
                      />
                    </div>

                    {/* Pickem Type */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">{t("pickems.form.type")}</label>
                      <select
                        value={pickemForm.type}
                        onChange={(e) => {
                          const newType = e.target.value as PickemType;
                          setPickemForm({
                            ...pickemForm,
                            type: newType,
                            guildCount: 10,
                            scoreOutOfRangeGuilds: newType === "regular" ? pickemForm.scoreOutOfRangeGuilds : false,
                            raidIds: newType === "rwf" ? [] : pickemForm.raidIds,
                          });
                        }}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                      >
                        <option value="regular">{t("pickems.form.typeRegular")}</option>
                        <option value="rwf">{t("pickems.form.typeRwf")}</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">{pickemForm.type === "regular" ? t("pickems.form.typeRegularHelp") : t("pickems.form.typeRwfHelp")}</p>
                    </div>

                    {/* Guild Count */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">{t("pickems.form.guildCount")}</label>
                      <input
                        type="number"
                        value={pickemForm.guildCount}
                        onChange={(e) => setPickemForm({ ...pickemForm, guildCount: parseInt(e.target.value) || 10 })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                        min="1"
                        max={pickemForm.type === "rwf" ? 25 : 10}
                      />
                      <p className="text-xs text-gray-500 mt-1">{t("pickems.form.guildCountHelp")}</p>
                    </div>

                    {/* Finalization Guild Count - only for RWF */}
                    {pickemForm.type === "rwf" && (
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Finalization Guild Count</label>
                        <input
                          type="number"
                          value={pickemForm.finalRankingsCount}
                          onChange={(e) => setPickemForm({ ...pickemForm, finalRankingsCount: parseInt(e.target.value) || 0 })}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                          min="0"
                          max="25"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          How many guilds admin must provide when finalizing (e.g. 10). Set to 0 to use guild count. Scoring uses all finalized guilds.
                        </p>
                      </div>
                    )}

                    {/* Raid Selection - only for regular type */}
                    {pickemForm.type === "regular" && (
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">{t("pickems.form.raids")}</label>
                        <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto bg-gray-700 p-3 rounded-lg">
                          <label className="col-span-2 flex items-start gap-2 rounded-md border border-amber-700/60 bg-amber-950/30 p-2.5 text-sm text-amber-100 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={pickemForm.raidIds.includes(PICKEM_PLACEHOLDER_RAID_ID)}
                              onChange={(e) => {
                                setPickemForm({
                                  ...pickemForm,
                                  raidIds: e.target.checked ? [PICKEM_PLACEHOLDER_RAID_ID] : [],
                                });
                              }}
                              className="mt-0.5 rounded border-gray-500"
                            />
                            <span>
                              <span className="block font-medium">{t("pickems.form.placeholderRaid")}</span>
                              <span className="mt-0.5 block text-xs text-amber-200/80">{t("pickems.form.placeholderRaidHelp")}</span>
                            </span>
                          </label>
                          {raids.map((raid) => (
                            <label key={raid.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={pickemForm.raidIds.includes(raid.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setPickemForm({
                                      ...pickemForm,
                                      raidIds: [...pickemForm.raidIds.filter((id) => id !== PICKEM_PLACEHOLDER_RAID_ID), raid.id],
                                    });
                                  } else {
                                    setPickemForm({ ...pickemForm, raidIds: pickemForm.raidIds.filter((id) => id !== raid.id) });
                                  }
                                }}
                                className="rounded border-gray-500"
                              />
                              {raid.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Extended regular scoring - only for regular type */}
                    {pickemForm.type === "regular" && (
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          id="scoreOutOfRangeGuilds"
                          checked={pickemForm.scoreOutOfRangeGuilds}
                          onChange={(e) => setPickemForm({ ...pickemForm, scoreOutOfRangeGuilds: e.target.checked })}
                          className="mt-1 rounded border-gray-500"
                        />
                        <div>
                          <label htmlFor="scoreOutOfRangeGuilds" className="text-sm text-gray-300">
                            {t("pickems.form.scoreOutOfRangeGuilds")}
                          </label>
                          <p className="text-xs text-gray-500 mt-1">{t("pickems.form.scoreOutOfRangeGuildsHelp")}</p>
                        </div>
                      </div>
                    )}

                    {/* Voting Dates */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">{t("pickems.form.votingStart")}</label>
                        <input
                          type="datetime-local"
                          value={pickemForm.votingStart}
                          onChange={(e) => setPickemForm({ ...pickemForm, votingStart: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">{t("pickems.form.votingEnd")}</label>
                        <input
                          type="datetime-local"
                          value={pickemForm.votingEnd}
                          onChange={(e) => setPickemForm({ ...pickemForm, votingEnd: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                          required
                        />
                      </div>
                    </div>

                    {/* Active Toggle */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="active"
                        checked={pickemForm.active}
                        onChange={(e) => setPickemForm({ ...pickemForm, active: e.target.checked })}
                        className="rounded border-gray-500"
                      />
                      <label htmlFor="active" className="text-sm text-gray-300">
                        {t("pickems.form.active")}
                      </label>
                    </div>

                    {/* Scoring Config */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-300 mb-2">{t("pickems.form.scoring")}</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(pickemForm.scoringConfig).map(([key, value]) => (
                          <div key={key}>
                            <label className="block text-xs text-gray-400 mb-1">{t(`pickems.form.scoring${key.charAt(0).toUpperCase() + key.slice(1)}`)}</label>
                            <input
                              type="number"
                              value={value}
                              onChange={(e) =>
                                setPickemForm({
                                  ...pickemForm,
                                  scoringConfig: { ...pickemForm.scoringConfig, [key]: parseInt(e.target.value) || 0 },
                                })
                              }
                              className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Streak Config */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-300 mb-2">{t("pickems.form.streak")}</h4>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="streakEnabled"
                            checked={pickemForm.streakConfig.enabled}
                            onChange={(e) =>
                              setPickemForm({
                                ...pickemForm,
                                streakConfig: { ...pickemForm.streakConfig, enabled: e.target.checked },
                              })
                            }
                            className="rounded border-gray-500"
                          />
                          <label htmlFor="streakEnabled" className="text-xs text-gray-400">
                            {t("pickems.form.streakEnabled")}
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">{t("pickems.form.streakMinLength")}</label>
                          <input
                            type="number"
                            value={pickemForm.streakConfig.minLength}
                            onChange={(e) =>
                              setPickemForm({
                                ...pickemForm,
                                streakConfig: { ...pickemForm.streakConfig, minLength: parseInt(e.target.value) || 2 },
                              })
                            }
                            className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                            min="2"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">{t("pickems.form.streakBonusPerGuild")}</label>
                          <input
                            type="number"
                            value={pickemForm.streakConfig.bonusPerGuild}
                            onChange={(e) =>
                              setPickemForm({
                                ...pickemForm,
                                streakConfig: { ...pickemForm.streakConfig, bonusPerGuild: parseInt(e.target.value) || 3 },
                              })
                            }
                            className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                            min="1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Prize Pool Configuration */}
                    <div className="border-t border-gray-700 pt-4">
                      <h4 className="text-sm font-semibold text-gray-300 mb-3">Prize Pool Configuration</h4>

                      <label className="flex items-center gap-2 mb-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pickemForm.prizeConfig.enabled}
                          onChange={(e) =>
                            setPickemForm((prev) => ({
                              ...prev,
                              prizeConfig: { ...prev.prizeConfig, enabled: e.target.checked },
                            }))
                          }
                          className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                        />
                        <span className="text-sm text-gray-300">Enable Gold Prizes</span>
                      </label>

                      {pickemForm.prizeConfig.enabled && (
                        <div className="space-y-3 pl-6">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Total Gold Pool</label>
                            <div className="relative">
                              <input
                                type="number"
                                min={0}
                                value={pickemForm.prizeConfig.goldPool}
                                onChange={(e) =>
                                  setPickemForm((prev) => ({
                                    ...prev,
                                    prizeConfig: { ...prev.prizeConfig, goldPool: parseInt(e.target.value) || 0 },
                                  }))
                                }
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm pr-12"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-yellow-500 font-medium">gold</span>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
                            <textarea
                              value={pickemForm.prizeConfig.description}
                              onChange={(e) =>
                                setPickemForm((prev) => ({
                                  ...prev,
                                  prizeConfig: { ...prev.prizeConfig, description: e.target.value },
                                }))
                              }
                              placeholder="e.g., Prizes paid out after race ends"
                              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm resize-none"
                              rows={2}
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-gray-400">Prize Distribution</label>
                              <button
                                type="button"
                                onClick={() =>
                                  setPickemForm((prev) => ({
                                    ...prev,
                                    prizeConfig: {
                                      ...prev.prizeConfig,
                                      distribution: [...prev.prizeConfig.distribution, { place: prev.prizeConfig.distribution.length + 1, percentage: 0 }],
                                    },
                                  }))
                                }
                                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                              >
                                + Add Tier
                              </button>
                            </div>

                            {pickemForm.prizeConfig.distribution.length > 0 ? (
                              <div className="space-y-2">
                                {pickemForm.prizeConfig.distribution.map((entry, idx) => (
                                  <div key={idx} className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500 w-8 shrink-0">#{entry.place}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={entry.percentage}
                                      onChange={(e) =>
                                        setPickemForm((prev) => ({
                                          ...prev,
                                          prizeConfig: {
                                            ...prev.prizeConfig,
                                            distribution: prev.prizeConfig.distribution.map((d, i) => (i === idx ? { ...d, percentage: parseInt(e.target.value) || 0 } : d)),
                                          },
                                        }))
                                      }
                                      className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                    />
                                    <span className="text-xs text-gray-500">%</span>
                                    {pickemForm.prizeConfig.goldPool > 0 && (
                                      <span className="text-xs text-yellow-500">({Math.round((pickemForm.prizeConfig.goldPool * entry.percentage) / 100).toLocaleString()}g)</span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPickemForm((prev) => ({
                                          ...prev,
                                          prizeConfig: {
                                            ...prev.prizeConfig,
                                            distribution: prev.prizeConfig.distribution.filter((_, i) => i !== idx).map((d, i) => ({ ...d, place: i + 1 })),
                                          },
                                        }))
                                      }
                                      className="text-gray-500 hover:text-red-400 transition-colors ml-auto"
                                    >
                                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                        <path
                                          fillRule="evenodd"
                                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                                {(() => {
                                  const total = pickemForm.prizeConfig.distribution.reduce((sum, d) => sum + d.percentage, 0);
                                  return (
                                    <p className={`text-xs mt-1 ${total === 100 ? "text-green-400" : "text-amber-400"}`}>
                                      Total: {total}% {total !== 100 && "(should be 100%)"}
                                    </p>
                                  );
                                })()}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-500">No prize tiers defined. Add tiers to split the gold pool.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Form Actions */}
                    <div className="flex gap-3 pt-4">
                      <button type="submit" className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors">
                        {editingPickem ? t("pickems.form.update") : t("pickems.form.create")}
                      </button>
                      <button type="button" onClick={() => setShowPickemForm(false)} className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors">
                        {t("pickems.form.cancel")}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* RWF Finalization Modal - search, add, reorder, remove guilds */}
            {showFinalizeModal &&
              finalizingPickem &&
              (() => {
                const requiredCount = finalizingPickem.finalRankingsCount || finalizingPickem.guildCount || 10;
                const availableGuilds = allRwfGuilds.filter((g) => !finalizationRankings.includes(g));
                const filteredAvailable = finalizeSearch ? availableGuilds.filter((g) => g.toLowerCase().includes(finalizeSearch.toLowerCase())) : availableGuilds;

                return (
                  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 rounded-lg p-6 max-w-lg w-full max-h-[90vh] flex flex-col">
                      <h3 className="text-xl font-bold text-white mb-2">{t("pickems.finalize.title", { name: finalizingPickem.name })}</h3>
                      <p className="text-gray-400 mb-4 text-sm">
                        {t("pickems.finalize.description")} Select {requiredCount} guilds in finishing order.
                      </p>

                      {/* Progress indicator */}
                      <div className="mb-3 flex items-center gap-2">
                        <span className={`text-sm font-medium ${finalizationRankings.length === requiredCount ? "text-emerald-400" : "text-amber-400"}`}>
                          {finalizationRankings.length} / {requiredCount} guilds selected
                        </span>
                        {finalizationRankings.length === requiredCount && (
                          <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>

                      {/* Current rankings - draggable + removable */}
                      <div className="flex-1 overflow-y-auto min-h-0 mb-4">
                        {finalizationRankings.length > 0 ? (
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(event: DragEndEvent) => {
                              const { active, over } = event;
                              if (over && active.id !== over.id) {
                                setFinalizationRankings((items) => {
                                  const oldIndex = items.indexOf(active.id as string);
                                  const newIndex = items.indexOf(over.id as string);
                                  return arrayMove(items, oldIndex, newIndex);
                                });
                              }
                            }}
                          >
                            <SortableContext items={finalizationRankings} strategy={verticalListSortingStrategy}>
                              <div className="space-y-1.5">
                                {finalizationRankings.map((guild, index) => (
                                  <SortableRankingItem key={guild} id={guild} rank={index + 1} onRemove={(id) => setFinalizationRankings((prev) => prev.filter((g) => g !== id))} />
                                ))}
                              </div>
                            </SortableContext>
                          </DndContext>
                        ) : (
                          <p className="text-gray-500 text-sm py-4 text-center">No guilds added yet. Search and add guilds below.</p>
                        )}
                      </div>

                      {/* Search and add guilds */}
                      {finalizationRankings.length < requiredCount && (
                        <div className="mb-4">
                          <input
                            type="text"
                            value={finalizeSearch}
                            onChange={(e) => setFinalizeSearch(e.target.value)}
                            placeholder="Search guilds to add..."
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm mb-2"
                          />
                          <div className="max-h-32 overflow-y-auto space-y-1">
                            {filteredAvailable.slice(0, 20).map((guild) => (
                              <button
                                key={guild}
                                type="button"
                                onClick={() => {
                                  if (finalizationRankings.length < requiredCount) {
                                    setFinalizationRankings((prev) => [...prev, guild]);
                                    setFinalizeSearch("");
                                  }
                                }}
                                className="w-full text-left px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600 rounded transition-colors flex items-center gap-2"
                              >
                                <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                {guild}
                              </button>
                            ))}
                            {filteredAvailable.length === 0 && <p className="text-gray-500 text-xs py-1 px-3">No matching guilds available</p>}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-3 pt-2 border-t border-gray-700">
                        <button
                          onClick={async () => {
                            if (finalizationRankings.length !== requiredCount) {
                              alert(`Please select exactly ${requiredCount} guilds. Currently selected: ${finalizationRankings.length}`);
                              return;
                            }
                            setIsFinalizingLoading(true);
                            try {
                              await api.finalizeRwfPickem(finalizingPickem.pickemId, finalizationRankings);
                              const pickemsData = await api.getAdminPickems();
                              setPickems(pickemsData.pickems);
                              setPickemStats(pickemsData.stats);
                              setShowFinalizeModal(false);
                              setFinalizingPickem(null);
                              setFinalizeSearch("");
                            } catch (err) {
                              console.error("Failed to finalize pickem:", err);
                              alert(err instanceof Error ? err.message : "Failed to finalize pickem");
                            } finally {
                              setIsFinalizingLoading(false);
                            }
                          }}
                          disabled={isFinalizingLoading || finalizationRankings.length !== requiredCount}
                          className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isFinalizingLoading ? t("pickems.finalize.loading") : t("pickems.finalize.confirm")}
                        </button>
                        <button
                          onClick={() => {
                            setShowFinalizeModal(false);
                            setFinalizingPickem(null);
                            setFinalizeSearch("");
                          }}
                          className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
                        >
                          {t("pickems.finalize.cancel")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

            {/* Pickems Table */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("pickems.table.id")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("pickems.table.name")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("pickems.table.type")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("pickems.table.raids")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("pickems.table.voting")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("pickems.table.status")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t("pickems.table.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {pickems.map((pickem) => {
                    const now = new Date();
                    const start = new Date(pickem.votingStart);
                    const end = new Date(pickem.votingEnd);
                    const isVotingOpen = now >= start && now <= end;
                    const hasEnded = now > end;

                    return (
                      <tr key={pickem.pickemId} className="hover:bg-gray-750">
                        <td className="px-4 py-3 text-white font-mono text-sm">{pickem.pickemId}</td>
                        <td className="px-4 py-3 text-white">{pickem.name}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${pickem.type === "rwf" ? "bg-purple-900/50 text-purple-400" : "bg-blue-900/50 text-blue-400"}`}
                          >
                            {pickem.type === "rwf" ? t("pickems.table.typeRwf") : t("pickems.table.typeRegular")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-sm">
                          {pickem.type === "rwf"
                            ? t("pickems.table.rwfGuilds", { count: pickem.guildCount })
                            : pickem.raidIds
                                .map((id) => (id === PICKEM_PLACEHOLDER_RAID_ID ? t("pickems.table.placeholderRaid") : raids.find((r) => r.id === id)?.name || id))
                                .join(", ")}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-sm">
                          <div>{new Date(pickem.votingStart).toLocaleDateString()}</div>
                          <div className="text-gray-500">→ {new Date(pickem.votingEnd).toLocaleDateString()}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {pickem.active ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-900/50 text-green-400">{t("pickems.table.activeStatus")}</span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-400">{t("pickems.table.inactiveStatus")}</span>
                            )}
                            {isVotingOpen && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-900/50 text-amber-400">
                                {t("pickems.table.votingOpenStatus")}
                              </span>
                            )}
                            {hasEnded && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-600 text-gray-300">{t("pickems.table.endedStatus")}</span>
                            )}
                            {pickem.type === "rwf" && pickem.finalized && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-900/50 text-emerald-400">
                                {t("pickems.table.finalizedStatus")}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingPickem(pickem);
                                setPickemForm({
                                  pickemId: pickem.pickemId,
                                  name: pickem.name,
                                  type: pickem.type || "regular",
                                  raidIds: pickem.raidIds,
                                  guildCount: pickem.guildCount || 10,
                                  finalRankingsCount: pickem.finalRankingsCount || 0,
                                  scoreOutOfRangeGuilds: pickem.scoreOutOfRangeGuilds ?? false,
                                  votingStart: new Date(pickem.votingStart).toISOString().slice(0, 16),
                                  votingEnd: new Date(pickem.votingEnd).toISOString().slice(0, 16),
                                  active: pickem.active,
                                  scoringConfig: pickem.scoringConfig,
                                  streakConfig: pickem.streakConfig,
                                  prizeConfig: pickem.prizeConfig || {
                                    enabled: false,
                                    goldPool: 0,
                                    distribution: [],
                                    description: "",
                                  },
                                });
                                setShowPickemForm(true);
                              }}
                              className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                            >
                              {t("pickems.table.edit")}
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await api.toggleAdminPickem(pickem.pickemId);
                                  const pickemsData = await api.getAdminPickems();
                                  setPickems(pickemsData.pickems);
                                  setPickemStats(pickemsData.stats);
                                } catch (err) {
                                  console.error("Failed to toggle pickem:", err);
                                }
                              }}
                              className={`px-2 py-1 text-white text-xs rounded ${pickem.active ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"}`}
                            >
                              {pickem.active ? t("pickems.table.deactivate") : t("pickems.table.activate")}
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm(t("pickems.table.deleteConfirm"))) {
                                  try {
                                    setError(null);
                                    await api.deleteAdminPickem(pickem.pickemId);
                                    const pickemsData = await api.getAdminPickems();
                                    setPickems(pickemsData.pickems);
                                    setPickemStats(pickemsData.stats);
                                  } catch (err) {
                                    console.error("Failed to delete pickem:", err);
                                    setError(t("pickems.table.deleteFailed"));
                                  }
                                }
                              }}
                              className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                            >
                              {t("pickems.table.delete")}
                            </button>
                            {/* RWF Finalization buttons */}
                            {pickem.type === "rwf" && !pickem.finalized && (
                              <button
                                onClick={async () => {
                                  // Fetch RWF guilds to populate the available guilds
                                  try {
                                    const rwfGuilds = await api.getPickemsRwfGuilds();
                                    setFinalizingPickem(pickem);
                                    setAllRwfGuilds(rwfGuilds.map((g) => g.name));
                                    setFinalizationRankings([]); // Start empty, admin picks guilds
                                    setFinalizeSearch("");
                                    setShowFinalizeModal(true);
                                  } catch (err) {
                                    console.error("Failed to get RWF guilds:", err);
                                  }
                                }}
                                className="px-2 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700"
                              >
                                {t("pickems.table.finalize")}
                              </button>
                            )}
                            {/* Regular pickem finalization button */}
                            {pickem.type === "regular" && !pickem.finalized && !pickem.raidIds.includes(PICKEM_PLACEHOLDER_RAID_ID) && (
                              <button
                                onClick={async () => {
                                  if (confirm(t("pickems.table.finalizeRegularConfirm"))) {
                                    try {
                                      await api.finalizeRegularPickem(pickem.pickemId);
                                      const pickemsData = await api.getAdminPickems();
                                      setPickems(pickemsData.pickems);
                                      setPickemStats(pickemsData.stats);
                                    } catch (err) {
                                      console.error("Failed to finalize pickem:", err);
                                    }
                                  }
                                }}
                                className="px-2 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700"
                              >
                                {t("pickems.table.finalize")}
                              </button>
                            )}
                            {/* Unfinalize button - works for both types */}
                            {pickem.finalized && (
                              <button
                                onClick={async () => {
                                  if (confirm(t("pickems.table.unfinalizeConfirm"))) {
                                    try {
                                      await api.unfinalizePickem(pickem.pickemId);
                                      const pickemsData = await api.getAdminPickems();
                                      setPickems(pickemsData.pickems);
                                      setPickemStats(pickemsData.stats);
                                    } catch (err) {
                                      console.error("Failed to unfinalize pickem:", err);
                                    }
                                  }
                                }}
                                className="px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700"
                              >
                                {t("pickems.table.unfinalize")}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* System Tab - Rate Limits & Processing Queue */}
        {!loading && activeTab === "system" && (
          <div className="space-y-6">
            {/* Rate Limit Status */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>⚡</span> WarcraftLogs Rate Limit
              </h2>
              {rateLimitStatus && rateLimitConfig && (
                <div className="bg-gray-800 rounded-lg p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h4 className="text-gray-400 text-sm">Points Used</h4>
                      <p className="text-2xl font-bold text-white">
                        {rateLimitStatus.pointsUsed} / {rateLimitStatus.pointsMax}
                      </p>
                      <p className="text-sm text-gray-500">{rateLimitStatus.pointsRemaining} remaining</p>
                    </div>
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h4 className="text-gray-400 text-sm">Usage</h4>
                      <p
                        className={`text-2xl font-bold ${
                          rateLimitStatus.percentUsed >= 80 ? "text-red-400" : rateLimitStatus.percentUsed >= 60 ? "text-amber-400" : "text-green-400"
                        }`}
                      >
                        {rateLimitStatus.percentUsed.toFixed(1)}%
                      </p>
                      <div className="w-full bg-gray-600 rounded-full h-2 mt-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            rateLimitStatus.percentUsed >= 80 ? "bg-red-500" : rateLimitStatus.percentUsed >= 60 ? "bg-amber-500" : "bg-green-500"
                          }`}
                          style={{ width: `${Math.min(100, rateLimitStatus.percentUsed)}%` }}
                        />
                      </div>
                    </div>
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h4 className="text-gray-400 text-sm">Resets In</h4>
                      <p className="text-2xl font-bold text-white">
                        {Math.floor(rateLimitStatus.resetInSeconds / 60)}m {rateLimitStatus.resetInSeconds % 60}s
                      </p>
                      <p className="text-sm text-gray-500">{new Date(rateLimitStatus.resetAt).toLocaleTimeString()}</p>
                    </div>
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h4 className="text-gray-400 text-sm">Status</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-block w-3 h-3 rounded-full ${rateLimitStatus.isPaused ? "bg-red-500" : "bg-green-500"}`} />
                        <span className={`text-lg font-bold ${rateLimitStatus.isPaused ? "text-red-400" : "text-green-400"}`}>
                          {rateLimitStatus.isPaused ? "Paused" : "Active"}
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await api.setAdminRateLimitPause(!rateLimitStatus.isPaused);
                            const data = await api.getAdminRateLimitStatus();
                            setRateLimitStatus(data.status);
                          } catch (err) {
                            console.error("Failed to toggle pause:", err);
                          }
                        }}
                        className={`mt-2 px-3 py-1 text-sm rounded ${
                          rateLimitStatus.isPaused ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"
                        }`}
                      >
                        {rateLimitStatus.isPaused ? "Resume" : "Pause"}
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    <span className="mr-4">Reserve: {rateLimitConfig.liveOperationsReserve}%</span>
                    <span className="mr-4">Warning: {rateLimitConfig.warningThreshold}%</span>
                    <span>Pause at: {rateLimitConfig.pauseThreshold}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Warcraft Logs User Authorization */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🔐</span> WarcraftLogs User Access
              </h2>
              {wclUserAuthStatus && (
                <div className="bg-gray-800 rounded-lg p-6 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h4 className="text-gray-400 text-sm">OAuth</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-block w-3 h-3 rounded-full ${wclUserAuthStatus.enabled ? "bg-green-500" : "bg-red-500"}`} />
                        <span className={`text-lg font-bold ${wclUserAuthStatus.enabled ? "text-green-400" : "text-red-400"}`}>
                          {wclUserAuthStatus.enabled ? "Configured" : "Missing"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-gray-500 break-all">{wclUserAuthStatus.redirectUri}</p>
                    </div>
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h4 className="text-gray-400 text-sm">Connected User</h4>
                      <p className={`text-lg font-bold mt-1 ${wclUserAuthStatus.connected ? "text-white" : "text-amber-400"}`}>
                        {wclUserAuthStatus.wclUserName || (wclUserAuthStatus.connected ? "Connected" : "Not connected")}
                      </p>
                      {wclUserAuthStatus.connectedByUsername && <p className="text-sm text-gray-500">by {wclUserAuthStatus.connectedByUsername}</p>}
                      {wclUserAuthStatus.tokenExpiresAt && <p className="text-sm text-gray-500">token: {formatDate(wclUserAuthStatus.tokenExpiresAt)}</p>}
                    </div>
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h4 className="text-gray-400 text-sm">Death Fetch Gaps</h4>
                      <p className="text-sm text-gray-300 mt-2">
                        <span className="text-amber-300 font-semibold">{wclUserAuthStatus.deathEvents.pending}</span> pending
                      </p>
                      <p className="text-sm text-gray-300">
                        <span className="text-red-300 font-semibold">{wclUserAuthStatus.deathEvents.failed}</span> failed
                      </p>
                      <p className="text-sm text-gray-300">
                        <span className="text-purple-300 font-semibold">{wclUserAuthStatus.deathEvents.archived}</span> archived
                      </p>
                    </div>
                    <div className="bg-gray-700 rounded-lg p-4">
                      <h4 className="text-gray-400 text-sm">Verification</h4>
                      <p className="text-sm text-gray-300 mt-2">{wclUserAuthStatus.lastVerifiedAt ? formatDate(wclUserAuthStatus.lastVerifiedAt) : "Not verified"}</p>
                      {wclUserAuthStatus.lastVerifiedError && <p className="mt-1 text-xs text-red-300" title={wclUserAuthStatus.lastVerifiedError}>{wclUserAuthStatus.lastVerifiedError}</p>}
                      {wclUserAuthStatus.lastRefreshError && <p className="mt-1 text-xs text-red-300" title={wclUserAuthStatus.lastRefreshError}>{wclUserAuthStatus.lastRefreshError}</p>}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleConnectWclUser}
                      disabled={!wclUserAuthStatus.enabled || triggerLoading === "wcl-user-connect"}
                      className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {wclUserAuthStatus.connected ? "Reconnect WCL User" : "Connect WCL User"}
                    </button>
                    <button
                      onClick={handleVerifyWclUser}
                      disabled={!wclUserAuthStatus.connected || triggerLoading === "wcl-user-verify"}
                      className="px-3 py-2 bg-gray-700 text-gray-200 text-sm rounded hover:bg-gray-600 disabled:opacity-50"
                    >
                      Verify User
                    </button>
                    <button
                      onClick={handleResetFailedArchivedDeaths}
                      disabled={triggerLoading === "death-events-reset" || (wclUserAuthStatus.deathEvents.failed === 0 && wclUserAuthStatus.deathEvents.archived === 0)}
                      className="px-3 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50"
                    >
                      Reset Failed/Archived Deaths
                    </button>
                    <button
                      onClick={handleDisconnectWclUser}
                      disabled={!wclUserAuthStatus.connected || triggerLoading === "wcl-user-disconnect"}
                      className="px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <label className="flex-1">
                      <span className="block text-sm text-gray-400 mb-1">Archived report probe</span>
                      <input
                        value={wclProbeReportCode}
                        onChange={(event) => setWclProbeReportCode(event.target.value)}
                        placeholder="Report code"
                        className="w-full bg-gray-700 text-white rounded-lg px-3 py-2"
                      />
                    </label>
                    <button
                      onClick={handleProbeWclReport}
                      disabled={!wclUserAuthStatus.connected || triggerLoading === "wcl-user-probe"}
                      className="px-3 py-2 bg-gray-700 text-gray-200 text-sm rounded hover:bg-gray-600 disabled:opacity-50"
                    >
                      Probe Report
                    </button>
                  </div>

                  {wclProbeResult && (
                    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 text-sm text-gray-300">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                          <span className="block text-gray-500">Report</span>
                          <span className="font-semibold text-white">{wclProbeResult.report?.code || "Unknown"}</span>
                        </div>
                        <div>
                          <span className="block text-gray-500">Archived</span>
                          <span className="font-semibold text-white">{wclProbeResult.report?.archiveStatus?.isArchived ? "Yes" : "No"}</span>
                        </div>
                        <div>
                          <span className="block text-gray-500">Accessible</span>
                          <span className={`font-semibold ${wclProbeResult.report?.archiveStatus?.isAccessible ? "text-green-300" : "text-red-300"}`}>
                            {wclProbeResult.report?.archiveStatus?.isAccessible ? "Yes" : "No"}
                          </span>
                        </div>
                        <div>
                          <span className="block text-gray-500">Death Events</span>
                          <span className="font-semibold text-white">
                            {wclProbeResult.deathEventProbe ? `${wclProbeResult.deathEventProbe.eventCount ?? "?"} from ${wclProbeResult.deathEventProbe.fightsTested} fights` : "No stored fights"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mythic+ Crawler */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🗝️</span> Mythic+ Crawler
              </h2>
              <div className="bg-gray-800 rounded-lg p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {renderTriggerButton("backfill-mythic-plus-historical", "Start Full Historical Backfill", triggerBackfillMythicPlusHistorical, {
                    disabled: mythicPlusCrawlerStatus?.processor.isRunning,
                  })}
                  {renderTriggerButton("refresh-mythic-plus-current", "Refresh Current Season", triggerRefreshMythicPlusCurrentSeason, {
                    disabled: mythicPlusCrawlerStatus?.processor.isRunning,
                  })}
                </div>
                {mythicPlusCrawlerStatus ? (
                  <MythicPlusCrawlerStatusPanel status={mythicPlusCrawlerStatus} />
                ) : (
                  <div className="rounded bg-gray-900/60 border border-gray-700 p-3 text-sm text-gray-400">Mythic+ crawler status has not loaded yet.</div>
                )}
              </div>
            </div>

            {/* Processing Queue */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>📦</span> Guild Processing Queue
              </h2>

              {/* Processor Status & Queue Stats */}
              {processorStatus && queueStats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h4 className="text-gray-400 text-sm">Processor</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-block w-3 h-3 rounded-full ${processorStatus.isRunning && !processorStatus.isPaused ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="text-lg font-bold text-white">{processorStatus.isPaused ? "Paused" : processorStatus.isRunning ? "Running" : "Stopped"}</span>
                    </div>
                    {processorStatus.currentGuild && <p className="text-sm text-gray-400 mt-1 truncate">{processorStatus.currentGuild}</p>}
                    <button
                      onClick={async () => {
                        try {
                          await api.setAdminProcessingQueuePauseAll(!processorStatus.isPaused);
                          const data = await api.getAdminProcessingQueueStats();
                          setProcessorStatus(data.processor);
                        } catch (err) {
                          console.error("Failed to toggle processor:", err);
                        }
                      }}
                      className={`mt-2 px-3 py-1 text-sm rounded ${
                        processorStatus.isPaused ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"
                      }`}
                    >
                      {processorStatus.isPaused ? "Resume All" : "Pause All"}
                    </button>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h4 className="text-gray-400 text-sm">Pending</h4>
                    <p className="text-2xl font-bold text-amber-400">{queueStats.pending}</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h4 className="text-gray-400 text-sm">In Progress</h4>
                    <p className="text-2xl font-bold text-blue-400">{queueStats.inProgress}</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h4 className="text-gray-400 text-sm">Completed</h4>
                    <p className="text-2xl font-bold text-green-400">{queueStats.completed}</p>
                    {queueStats.completed > 0 && (
                      <button
                        onClick={async () => {
                          if (confirm(`Clear all ${queueStats.completed} completed guilds from the queue?`)) {
                            try {
                              const result = await api.clearAdminProcessingQueueCompleted();
                              setTriggerMessage({ type: "success", text: result.message });
                              setTimeout(() => setTriggerMessage(null), 5000);
                              // Refresh queue stats
                              const statsData = await api.getAdminProcessingQueueStats();
                              setQueueStats(statsData.queue);
                              setProcessorStatus(statsData.processor);
                              // Refresh queue items if viewing completed
                              if (queueFilter === "completed" || queueFilter === "") {
                                const queueData = await api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined);
                                setQueueItems(queueData.items);
                                setQueueTotalPages(queueData.pagination.totalPages);
                              }
                            } catch (err) {
                              console.error("Failed to clear completed:", err);
                              setTriggerMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to clear completed guilds" });
                            }
                          }
                        }}
                        className="mt-2 px-2 py-1 text-xs bg-gray-600 text-gray-200 rounded hover:bg-gray-500 transition-colors"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h4 className="text-gray-400 text-sm">Failed</h4>
                    <p className="text-2xl font-bold text-red-400">{queueStats.failed}</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h4 className="text-gray-400 text-sm">Paused</h4>
                    <p className="text-2xl font-bold text-gray-400">{queueStats.paused}</p>
                  </div>
                </div>
              )}

              {/* Queue Filter */}
              <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
                <select
                  value={queueFilter}
                  onChange={(e) => {
                    setQueueFilter(e.target.value as ProcessingStatus | "");
                    setQueuePage(1);
                  }}
                  className="bg-gray-700 text-white rounded-lg px-3 py-2"
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="paused">Paused</option>
                </select>
                <button
                  onClick={handleClearProcessingQueue}
                  disabled={queueTotalCount === 0 || triggerLoading === "clear-processing-queue"}
                  className="min-h-10 px-3 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,transform]"
                >
                  {triggerLoading === "clear-processing-queue" ? "Clearing..." : `Clear Entire Queue (${queueTotalCount})`}
                </button>
              </div>

              {/* Error Breakdown */}
              {queueStats?.errorBreakdown && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <span>⚠️</span> Error Breakdown
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="bg-gray-800 rounded-lg p-3 border-l-4 border-red-500">
                      <h4 className="text-gray-400 text-xs uppercase">Guild Not Found</h4>
                      <p className="text-xl font-bold text-red-400">{queueStats.errorBreakdown.guild_not_found}</p>
                      <span className="text-xs text-red-300">Permanent</span>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3 border-l-4 border-yellow-500">
                      <h4 className="text-gray-400 text-xs uppercase">Rate Limited</h4>
                      <p className="text-xl font-bold text-yellow-400">{queueStats.errorBreakdown.rate_limited}</p>
                      <span className="text-xs text-yellow-300">Retryable</span>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3 border-l-4 border-orange-500">
                      <h4 className="text-gray-400 text-xs uppercase">Network Error</h4>
                      <p className="text-xl font-bold text-orange-400">{queueStats.errorBreakdown.network_error}</p>
                      <span className="text-xs text-orange-300">Retryable</span>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3 border-l-4 border-purple-500">
                      <h4 className="text-gray-400 text-xs uppercase">API Error</h4>
                      <p className="text-xl font-bold text-purple-400">{queueStats.errorBreakdown.api_error}</p>
                      <span className="text-xs text-purple-300">Retryable</span>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3 border-l-4 border-blue-500">
                      <h4 className="text-gray-400 text-xs uppercase">Database Error</h4>
                      <p className="text-xl font-bold text-blue-400">{queueStats.errorBreakdown.database_error}</p>
                      <span className="text-xs text-blue-300">Retryable</span>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3 border-l-4 border-gray-500">
                      <h4 className="text-gray-400 text-xs uppercase">Unknown</h4>
                      <p className="text-xl font-bold text-gray-400">{queueStats.errorBreakdown.unknown}</p>
                      <span className="text-xs text-gray-300">Needs Review</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Recent Errors Section */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setShowErrorDetails(!showErrorDetails)}
                    className="flex items-center gap-2 text-lg font-semibold text-white hover:text-amber-400 transition-colors"
                  >
                    <span>{showErrorDetails ? "▼" : "▶"}</span>
                    <span>🔴</span> Recent Errors ({errorItems.length})
                  </button>

                  {/* Clear Errors Buttons */}
                  {queueStats && queueStats.failed > 0 && (
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (confirm(`Reset ${queueStats.failed} failed guilds for retry? This will clear their error state and move them back to pending.`)) {
                            try {
                              const result = await api.clearAdminProcessingQueueErrors("reset");
                              setTriggerMessage({ type: "success", text: result.message });
                              setTimeout(() => setTriggerMessage(null), 5000);
                              // Refresh stats and errors
                              const [statsData, errorsData] = await Promise.all([api.getAdminProcessingQueueStats(), api.getAdminProcessingQueueErrors(1, 50)]);
                              setQueueStats(statsData.queue);
                              setProcessorStatus(statsData.processor);
                              setErrorItems(errorsData.items);
                              // Refresh queue items
                              const queueData = await api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined);
                              setQueueItems(queueData.items);
                              setQueueTotalPages(queueData.pagination.totalPages);
                            } catch (err) {
                              console.error("Failed to reset errors:", err);
                              setTriggerMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to reset errors" });
                            }
                          }
                        }}
                        className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
                      >
                        Reset for Retry
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Remove ${queueStats.failed} failed guilds from the queue? This action cannot be undone.`)) {
                            try {
                              const result = await api.clearAdminProcessingQueueErrors("remove");
                              setTriggerMessage({ type: "success", text: result.message });
                              setTimeout(() => setTriggerMessage(null), 5000);
                              // Refresh stats and errors
                              const [statsData, errorsData] = await Promise.all([api.getAdminProcessingQueueStats(), api.getAdminProcessingQueueErrors(1, 50)]);
                              setQueueStats(statsData.queue);
                              setProcessorStatus(statsData.processor);
                              setErrorItems(errorsData.items);
                              // Refresh queue items
                              const queueData = await api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined);
                              setQueueItems(queueData.items);
                              setQueueTotalPages(queueData.pagination.totalPages);
                            } catch (err) {
                              console.error("Failed to remove errors:", err);
                              setTriggerMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to remove failed guilds" });
                            }
                          }
                        }}
                        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                      >
                        Remove All Failed
                      </button>
                    </div>
                  )}
                </div>

                {showErrorDetails && (
                  <div className="space-y-4">
                    {/* Error Type Filter */}
                    <div className="flex gap-2">
                      <select value={errorFilter} onChange={(e) => setErrorFilter(e.target.value as ErrorType | "all")} className="bg-gray-700 text-white rounded-lg px-3 py-2">
                        <option value="all">All Error Types</option>
                        <option value="guild_not_found">Guild Not Found</option>
                        <option value="rate_limited">Rate Limited</option>
                        <option value="network_error">Network Error</option>
                        <option value="api_error">API Error</option>
                        <option value="database_error">Database Error</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>

                    {/* Errors Table */}
                    <div className="bg-gray-800 rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-900">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Guild</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Error Type</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Reason</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                          {errorItems
                            .filter((item) => errorFilter === "all" || item.errorType === errorFilter)
                            .map((item) => {
                              const getErrorTypeBadge = (errorType?: ErrorType) => {
                                switch (errorType) {
                                  case "guild_not_found":
                                    return "bg-red-900 text-red-300 border border-red-500";
                                  case "rate_limited":
                                    return "bg-yellow-900 text-yellow-300";
                                  case "network_error":
                                    return "bg-orange-900 text-orange-300";
                                  case "api_error":
                                    return "bg-purple-900 text-purple-300";
                                  case "database_error":
                                    return "bg-blue-900 text-blue-300";
                                  default:
                                    return "bg-gray-700 text-gray-300";
                                }
                              };

                              const formatErrorType = (errorType?: ErrorType) => {
                                if (!errorType) return "Unknown";
                                return errorType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                              };

                              return (
                                <tr key={item.id} className={`hover:bg-gray-750 ${item.isPermanentError ? "bg-red-950/30" : ""}`}>
                                  <td className="px-4 py-3">
                                    <div className="text-white font-medium">{item.guildName}</div>
                                    <div className="text-gray-400 text-sm">
                                      {item.guildRealm}-{item.guildRegion.toUpperCase()}
                                    </div>
                                    {item.jobType && item.jobType !== "full_rescan" && (
                                      <span
                                        className={`mt-1 inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                          item.jobType === "rescan_deaths"
                                            ? "bg-teal-900 text-teal-300"
                                            : item.jobType === "backfill_report_characters"
                                              ? "bg-sky-900 text-sky-300"
                                              : "bg-cyan-900 text-cyan-300"
                                        }`}
                                      >
                                        {item.jobType === "rescan_deaths" ? "Deaths" : item.jobType === "backfill_report_characters" ? "Report Chars" : "Characters"}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span
                                      className={`px-2 py-1 rounded text-xs font-medium ${
                                        item.status === "failed"
                                          ? "bg-red-900 text-red-300"
                                          : item.status === "paused"
                                            ? "bg-gray-700 text-gray-300"
                                            : "bg-amber-900 text-amber-300"
                                      }`}
                                    >
                                      {item.status.replace("_", " ")}
                                    </span>
                                    {item.errorCount > 1 && <span className="ml-2 text-xs text-gray-400">({item.errorCount}x)</span>}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${getErrorTypeBadge(item.errorType)}`}>{formatErrorType(item.errorType)}</span>
                                    {item.isPermanentError && (
                                      <span className="ml-2 text-xs text-red-400 font-semibold" title="This error is permanent and will not be retried">
                                        PERMANENT
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-gray-300 text-sm" title={item.lastError}>
                                      {item.failureReason || item.lastError || "No details available"}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-gray-400 text-sm">{item.lastErrorAt ? formatDate(item.lastErrorAt) : "-"}</td>
                                </tr>
                              );
                            })}
                          {errorItems.filter((item) => errorFilter === "all" || item.errorType === errorFilter).length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                                No errors
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Queue Table */}
              <div className="bg-gray-800 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Guild</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Progress</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Reports</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Fights / Chars</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Last Activity</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {queueItems.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-750">
                        <td className="px-4 py-3">
                          <div className="text-white font-medium">{item.guildName}</div>
                          <div className="text-gray-400 text-sm">
                            {item.guildRealm}-{item.guildRegion.toUpperCase()}
                          </div>
                          {item.jobType && item.jobType !== "full_rescan" && (
                            <span
                              className={`mt-1 inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                item.jobType === "rescan_deaths"
                                  ? "bg-teal-900 text-teal-300"
                                  : item.jobType === "backfill_report_characters"
                                    ? "bg-sky-900 text-sky-300"
                                    : "bg-cyan-900 text-cyan-300"
                              }`}
                            >
                              {item.jobType === "rescan_deaths" ? "Deaths" : item.jobType === "backfill_report_characters" ? "Report Chars" : "Characters"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              item.status === "completed"
                                ? "bg-green-900 text-green-300"
                                : item.status === "in_progress"
                                  ? "bg-blue-900 text-blue-300"
                                  : item.status === "pending"
                                    ? "bg-amber-900 text-amber-300"
                                    : item.status === "failed"
                                      ? "bg-red-900 text-red-300"
                                      : "bg-gray-700 text-gray-300"
                            }`}
                          >
                            {item.status.replace("_", " ")}
                          </span>
                          {item.errorCount > 0 && (
                            <span className="ml-2 text-xs text-red-400" title={item.lastError}>
                              ({item.errorCount} errors)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-300">{item.progress.percentComplete}%</td>
                        <td className="px-4 py-3 text-gray-300">
                          {item.progress.reportsFetched}
                          {item.progress.totalReportsEstimate > 0 && <span className="text-gray-500"> / ~{item.progress.totalReportsEstimate}</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-300">{item.progress.fightsSaved}</td>
                        <td className="px-4 py-3 text-gray-400 text-sm">{formatDate(item.lastActivityAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {(item.status === "pending" || item.status === "in_progress") && (
                              <button
                                onClick={async () => {
                                  try {
                                    await api.pauseAdminProcessingQueueGuild(item.guildId, item.id);
                                    const data = await api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined);
                                    setQueueItems(data.items);
                                  } catch (err) {
                                    console.error("Failed to pause:", err);
                                  }
                                }}
                                className="px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700"
                              >
                                Pause
                              </button>
                            )}
                            {(item.status === "paused" || item.status === "failed") && (
                              <button
                                onClick={async () => {
                                  try {
                                    await api.resumeAdminProcessingQueueGuild(item.guildId, item.id);
                                    const data = await api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined);
                                    setQueueItems(data.items);
                                  } catch (err) {
                                    console.error("Failed to resume:", err);
                                  }
                                }}
                                className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                              >
                                Resume
                              </button>
                            )}
                            {item.status === "failed" && (
                              <button
                                onClick={async () => {
                                  try {
                                    await api.retryAdminProcessingQueueGuild(item.guildId, item.id);
                                    const data = await api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined);
                                    setQueueItems(data.items);
                                  } catch (err) {
                                    console.error("Failed to retry:", err);
                                  }
                                }}
                                className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                              >
                                Retry
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                if (confirm(`Remove ${item.guildName} from queue?`)) {
                                  try {
                                    await api.removeAdminProcessingQueueGuild(item.guildId, item.id);
                                    const data = await api.getAdminProcessingQueue(queuePage, 20, queueFilter || undefined);
                                    setQueueItems(data.items);
                                    const statsData = await api.getAdminProcessingQueueStats();
                                    setQueueStats(statsData.queue);
                                  } catch (err) {
                                    console.error("Failed to remove:", err);
                                  }
                                }
                              }}
                              className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {queueItems.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                          No items in queue
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Pagination */}
                {queueTotalPages > 1 && (
                  <div className="px-4 py-3 bg-gray-900 flex items-center justify-between">
                    <button
                      onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
                      disabled={queuePage === 1}
                      className="px-3 py-1 bg-gray-700 text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-gray-400">
                      Page {queuePage} of {queueTotalPages}
                    </span>
                    <button
                      onClick={() => setQueuePage((p) => Math.min(queueTotalPages, p + 1))}
                      disabled={queuePage === queueTotalPages}
                      className="px-3 py-1 bg-gray-700 text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tasks Tab - Scheduled Task Activity Log */}
        {!loading && activeTab === "tasks" && (
          <div className="space-y-6">
            {/* Stats Summary */}
            {taskStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("tasks.running")}</h4>
                  <p className="text-2xl font-bold text-blue-400">{taskStats.running}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("tasks.completedToday")}</h4>
                  <p className="text-2xl font-bold text-green-400">{taskStats.completed}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-gray-400 text-sm">{t("tasks.failedToday")}</h4>
                  <p className="text-2xl font-bold text-red-400">{taskStats.failed}</p>
                </div>
              </div>
            )}

            {/* View Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setTaskView("latest")}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${taskView === "latest" ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
              >
                {t("tasks.latestPerTask")}
              </button>
              <button
                onClick={() => setTaskView("history")}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${taskView === "history" ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
              >
                {t("tasks.recentHistory")}
              </button>
            </div>

            {/* Task Table */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-3 text-gray-400 text-sm font-medium">{t("tasks.taskName")}</th>
                      <th className="px-4 py-3 text-gray-400 text-sm font-medium">{t("tasks.status")}</th>
                      <th className="px-4 py-3 text-gray-400 text-sm font-medium">{t("tasks.startedAt")}</th>
                      <th className="px-4 py-3 text-gray-400 text-sm font-medium">{t("tasks.duration")}</th>
                      <th className="px-4 py-3 text-gray-400 text-sm font-medium">{t("tasks.details")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(taskView === "latest" ? taskLatest : taskLogs).map((log) => (
                      <tr key={log._id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="px-4 py-3 text-white font-medium text-sm">{log.taskName}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                              log.status === "running"
                                ? "bg-blue-500/20 text-blue-400"
                                : log.status === "completed"
                                  ? "bg-green-500/20 text-green-400"
                                  : "bg-red-500/20 text-red-400"
                            }`}
                          >
                            <span
                              className={`inline-block w-2 h-2 rounded-full ${
                                log.status === "running" ? "bg-blue-400 animate-pulse" : log.status === "completed" ? "bg-green-400" : "bg-red-400"
                              }`}
                            />
                            {log.status === "running" ? t("tasks.statusRunning") : log.status === "completed" ? t("tasks.statusCompleted") : t("tasks.statusFailed")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-sm">{new Date(log.startedAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-300 text-sm">
                          {log.durationMs != null
                            ? log.durationMs < 1000
                              ? `${log.durationMs}ms`
                              : log.durationMs < 60000
                                ? `${(log.durationMs / 1000).toFixed(1)}s`
                                : `${Math.floor(log.durationMs / 60000)}m ${Math.round((log.durationMs % 60000) / 1000)}s`
                            : log.status === "running"
                              ? "..."
                              : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {log.error ? (
                            <span className="text-red-400 truncate block max-w-xs" title={log.error}>
                              {log.error}
                            </span>
                          ) : log.metadata ? (
                            <span className="text-gray-400 truncate block max-w-xs" title={JSON.stringify(log.metadata)}>
                              {Object.entries(log.metadata)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(", ")}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(taskView === "latest" ? taskLatest : taskLogs).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                          {t("tasks.noTasks")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* User Pickems Modal */}
        {showUserPickemsModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gray-700">
                <h2 className="text-xl font-bold text-white">User Pickems: {selectedUserForPickems?.discord.username || "Unknown"}</h2>
                <button
                  onClick={() => {
                    setShowUserPickemsModal(false);
                    setSelectedUserForPickems(null);
                    setUserPickemsData(null);
                    setUserPickemsError(null);
                  }}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="p-4">
                {userPickemsLoading ? (
                  <div className="text-center py-8 text-gray-400">Loading user pickems...</div>
                ) : userPickemsError ? (
                  <div className="text-center py-8 text-red-400">{userPickemsError}</div>
                ) : !userPickemsData || userPickemsData.submissions.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">No pickem submissions found for this user.</div>
                ) : (
                  <div className="space-y-4">
                    {userPickemsData.submissions.map((submission) => (
                      <div key={`${submission.pickem.id}-${submission.updatedAt}`} className="bg-gray-700 rounded-lg p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                          <div>
                            <h4 className="text-white font-semibold">{submission.pickem.name}</h4>
                            <p className="text-gray-400 text-sm">ID: {submission.pickem.id}</p>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className={`px-2 py-1 rounded ${submission.pickem.type === "rwf" ? "bg-purple-900/50 text-purple-300" : "bg-blue-900/50 text-blue-300"}`}>
                              {submission.pickem.type.toUpperCase()}
                            </span>
                            <span className={`px-2 py-1 rounded ${submission.pickem.active ? "bg-green-900/50 text-green-300" : "bg-gray-600 text-gray-300"}`}>
                              {submission.pickem.active ? "Active" : "Inactive"}
                            </span>
                            <span className={`px-2 py-1 rounded ${submission.pickem.finalized ? "bg-emerald-900/50 text-emerald-300" : "bg-gray-600 text-gray-300"}`}>
                              {submission.pickem.finalized ? "Finalized" : "Not finalized"}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm mb-3">
                          <p className="text-gray-300">
                            <span className="text-gray-400">Guild count:</span> {submission.pickem.guildCount}
                          </p>
                          <p className="text-gray-300">
                            <span className="text-gray-400">Voting window:</span>{" "}
                            {submission.pickem.votingStart && submission.pickem.votingEnd
                              ? `${formatDate(submission.pickem.votingStart)} → ${formatDate(submission.pickem.votingEnd)}`
                              : "-"}
                          </p>
                          <p className="text-gray-300">
                            <span className="text-gray-400">Submitted:</span> {formatDate(submission.submittedAt)}
                          </p>
                          <p className="text-gray-300">
                            <span className="text-gray-400">Updated:</span> {formatDate(submission.updatedAt)}
                          </p>
                        </div>

                        <div className="bg-gray-800 rounded-md overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-gray-900">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Position</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Guild</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Realm</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                              {submission.predictions
                                .slice()
                                .sort((a, b) => a.position - b.position)
                                .map((prediction) => (
                                  <tr key={`${prediction.position}-${prediction.guildName}-${prediction.realm}`}>
                                    <td className="px-3 py-2 text-gray-300">{prediction.position}</td>
                                    <td className="px-3 py-2 text-white">{prediction.guildName}</td>
                                    <td className="px-3 py-2 text-gray-300">{prediction.realm}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Guild Detail Modal */}
        {showGuildDetail && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-700">
                <h2 className="text-xl font-bold text-white">{guildDetailLoading ? "Loading..." : selectedGuild?.name || "Guild Details"}</h2>
                <button
                  onClick={() => {
                    setShowGuildDetail(false);
                    setSelectedGuild(null);
                    setVerifyResult(null);
                  }}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-4">
                {guildDetailLoading ? (
                  <div className="text-center py-8 text-gray-400">Loading guild details...</div>
                ) : selectedGuild ? (
                  <div className="space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <h4 className="text-gray-400 text-sm">Realm</h4>
                        <p className="text-white">{selectedGuild.realm}</p>
                      </div>
                      <div>
                        <h4 className="text-gray-400 text-sm">Region</h4>
                        <p className="text-white uppercase">{selectedGuild.region}</p>
                      </div>
                      <div>
                        <h4 className="text-gray-400 text-sm">Faction</h4>
                        <p className={selectedGuild.faction === "Horde" ? "text-red-400" : "text-blue-400"}>{selectedGuild.faction || "Unknown"}</p>
                      </div>
                      <div>
                        <h4 className="text-gray-400 text-sm">WCL Status</h4>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            selectedGuild.wclStatus === "active"
                              ? "bg-green-900 text-green-300"
                              : selectedGuild.wclStatus === "not_found"
                                ? "bg-red-900 text-red-300"
                                : selectedGuild.wclStatus === "unclaimed"
                                  ? "bg-amber-900 text-amber-300"
                                  : "bg-gray-700 text-gray-300"
                          }`}
                        >
                          {selectedGuild.wclStatus.replace("_", " ")}
                        </span>
                        {selectedGuild.wclNotFoundCount > 0 && <span className="ml-2 text-xs text-red-400">({selectedGuild.wclNotFoundCount} failures)</span>}
                      </div>
                      <div>
                        <h4 className="text-gray-400 text-sm">RIO Status</h4>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            selectedGuild.rioStatus === "active"
                              ? "bg-green-900 text-green-300"
                              : selectedGuild.rioStatus === "not_found"
                                ? "bg-red-900 text-red-300"
                                : "bg-gray-700 text-gray-300"
                          }`}
                        >
                          {(selectedGuild.rioStatus || "unknown").replace("_", " ")}
                        </span>
                        {selectedGuild.lastRioUpdate && <span className="ml-2 text-xs text-gray-500">{new Date(selectedGuild.lastRioUpdate).toLocaleDateString()}</span>}
                      </div>
                      <div>
                        <h4 className="text-gray-400 text-sm">Activity</h4>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            selectedGuild.activityStatus === "active" ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-300"
                          }`}
                        >
                          {selectedGuild.activityStatus || "unknown"}
                        </span>
                      </div>
                      <div>
                        <h4 className="text-gray-400 text-sm">Raiding</h4>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${selectedGuild.isCurrentlyRaiding ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-300"}`}>
                          {selectedGuild.isCurrentlyRaiding ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>

                    {/* Data Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-gray-700 rounded-lg p-3">
                        <h4 className="text-gray-400 text-sm">Reports</h4>
                        <p className="text-2xl font-bold text-white">{selectedGuild.reportCount}</p>
                      </div>
                      <div className="bg-gray-700 rounded-lg p-3">
                        <h4 className="text-gray-400 text-sm">Fights</h4>
                        <p className="text-2xl font-bold text-white">{selectedGuild.fightCount}</p>
                      </div>
                      <div className="bg-gray-700 rounded-lg p-3">
                        <h4 className="text-gray-400 text-sm">WCL ID</h4>
                        <p className="text-lg font-medium text-white">{selectedGuild.warcraftlogsId || "N/A"}</p>
                      </div>
                      <div className="bg-gray-700 rounded-lg p-3">
                        <h4 className="text-gray-400 text-sm">Last Fetched</h4>
                        <p className="text-sm text-white">{selectedGuild.lastFetched ? formatDate(selectedGuild.lastFetched) : "Never"}</p>
                      </div>
                    </div>

                    {/* Warcraft Logs Sources */}
                    <section className="rounded-xl bg-gray-900/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-balance font-medium text-white">Warcraft Logs sources</h4>
                          <p className="mt-1 max-w-2xl text-pretty text-sm text-gray-400">
                            Reports from every source belong to this canonical guild. Historical sources are only fetched when you explicitly rescan them.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setAddLogSourceForm({ name: "", realm: "", region: selectedGuild.region.toUpperCase(), queueInitialScan: true });
                              setShowAddLogSourceModal(true);
                            }}
                            className="min-h-10 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-[scale,background-color] hover:bg-emerald-500 active:scale-[0.96]"
                          >
                            Add historical source
                          </button>
                          <button
                            onClick={openGuildMigration}
                            className="min-h-10 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-[scale,background-color] hover:bg-violet-500 active:scale-[0.96]"
                          >
                            Convert existing guild
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        {selectedGuild.logSources.map((source) => {
                          const sourceBusy = logSourceActionLoading === source.id;
                          const scanRunning = source.queueStatus?.status === "pending" || source.queueStatus?.status === "in_progress" || source.queueStatus?.status === "paused";
                          return (
                            <div key={source.id} className={`rounded-lg bg-gray-800 p-3 ${source.enabled ? "" : "opacity-60"}`}>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-white">{source.name}</span>
                                    <span className="text-sm text-gray-400">
                                      {source.realm} · {source.region}
                                    </span>
                                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${source.isPrimary ? "bg-blue-900 text-blue-200" : "bg-gray-700 text-gray-300"}`}>
                                      {source.isPrimary ? "Primary · scheduled" : "Historical · manual"}
                                    </span>
                                    <span
                                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                                        source.wclStatus === "active"
                                          ? "bg-green-900 text-green-300"
                                          : source.wclStatus === "not_found"
                                            ? "bg-red-900 text-red-300"
                                            : "bg-gray-700 text-gray-300"
                                      }`}
                                    >
                                      {source.wclStatus.replace("_", " ")}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                                    <span className="tabular-nums">{source.reportCount.toLocaleString()} reports</span>
                                    <span>WCL ID: {source.warcraftlogsId || "not resolved"}</span>
                                    <span>Last fetched: {source.lastFetched ? formatDate(source.lastFetched) : "never"}</span>
                                    {source.queueStatus && <span>Queue: {source.queueStatus.status.replace("_", " ")}</span>}
                                  </div>
                                  {source.queueStatus?.lastError && <p className="mt-1 text-pretty text-xs text-red-300">{source.queueStatus.lastError}</p>}
                                </div>

                                {!source.isPrimary && (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleRescanLogSource(source.id)}
                                      disabled={sourceBusy || scanRunning || !source.enabled}
                                      className="min-h-10 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-[scale,background-color] hover:bg-blue-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {sourceBusy ? "Working…" : scanRunning ? "Queued" : "Full rescan"}
                                    </button>
                                    <button
                                      onClick={() => handleToggleLogSource(source.id, !source.enabled)}
                                      disabled={sourceBusy || scanRunning}
                                      className="min-h-10 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition-[scale,background-color] hover:bg-gray-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {source.enabled ? "Disable" : "Enable"}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    {/* Queue Status */}
                    {selectedGuild.queueStatus && (
                      <div className="bg-gray-700 rounded-lg p-4">
                        <h4 className="text-white font-medium mb-2">Queue Status</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <span className="text-gray-400 text-sm">Status:</span>
                            <span
                              className={`ml-2 px-2 py-1 rounded text-xs font-medium ${
                                selectedGuild.queueStatus.status === "completed"
                                  ? "bg-green-900 text-green-300"
                                  : selectedGuild.queueStatus.status === "in_progress"
                                    ? "bg-blue-900 text-blue-300"
                                    : selectedGuild.queueStatus.status === "failed"
                                      ? "bg-red-900 text-red-300"
                                      : "bg-gray-600 text-gray-300"
                              }`}
                            >
                              {selectedGuild.queueStatus.status.replace("_", " ")}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400 text-sm">Progress:</span>
                            <span className="ml-2 text-white">{selectedGuild.queueStatus.progress.percentComplete}%</span>
                          </div>
                          <div>
                            <span className="text-gray-400 text-sm">Reports:</span>
                            <span className="ml-2 text-white">{selectedGuild.queueStatus.progress.reportsFetched}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 text-sm">Errors:</span>
                            <span className={`ml-2 ${selectedGuild.queueStatus.errorCount > 0 ? "text-red-400" : "text-white"}`}>{selectedGuild.queueStatus.errorCount}</span>
                          </div>
                        </div>
                        {selectedGuild.queueStatus.lastError && (
                          <div className="mt-3 p-2 bg-red-900/50 rounded">
                            <span className="text-red-300 text-sm">{selectedGuild.queueStatus.lastError}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Progress */}
                    {selectedGuild.progress && selectedGuild.progress.length > 0 && (
                      <div>
                        <h4 className="text-white font-medium mb-2">Raid Progress</h4>
                        <div className="space-y-2">
                          {selectedGuild.progress.map((p, i) => {
                            const isExcluded = selectedGuild.excludedRaidIds?.includes(p.raidId);
                            return (
                              <div key={i} className={`flex items-center justify-between bg-gray-700 rounded p-2 ${isExcluded ? "opacity-50" : ""}`}>
                                <span className="text-white">
                                  {p.raidName} ({p.difficulty})
                                </span>
                                <span className="text-gray-300">
                                  {p.bossesDefeated}/{p.totalBosses}
                                  {isExcluded && <span className="ml-2 text-red-400 text-xs">(excluded)</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Raid Tier Exclusions */}
                    <div>
                      <h4 className="text-white font-medium mb-2">Raid Tier Exclusions</h4>
                      <p className="text-xs text-gray-500 mb-3">Excluded raids will hide this guild from progress rankings, tier lists, and timetables for that tier.</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {adminRaids.map((raid) => {
                          const isExcluded = selectedGuild.excludedRaidIds?.includes(raid.id);
                          return (
                            <div key={raid.id} className="flex items-center justify-between bg-gray-700 rounded p-2">
                              <span className={`text-sm ${isExcluded ? "text-red-400" : "text-white"}`}>
                                {raid.name}
                                {raid.isPrimary ? (
                                  <span className="ml-1 text-blue-300 text-xs">(primary)</span>
                                ) : (
                                  raid.isCurrent && <span className="ml-1 text-amber-400 text-xs">(current)</span>
                                )}
                              </span>
                              <button
                                onClick={async () => {
                                  try {
                                    const result = await api.toggleGuildRaidExclusion(selectedGuild.id, raid.id, !isExcluded);
                                    setSelectedGuild({ ...selectedGuild, excludedRaidIds: result.excludedRaidIds });
                                    setTriggerMessage({
                                      type: "success",
                                      text: `${raid.name}: ${!isExcluded ? "excluded" : "included"} for ${selectedGuild.name}`,
                                    });
                                    setTimeout(() => setTriggerMessage(null), 5000);
                                  } catch (error) {
                                    setTriggerMessage({
                                      type: "error",
                                      text: error instanceof Error ? error.message : "Failed to toggle exclusion",
                                    });
                                    setTimeout(() => setTriggerMessage(null), 5000);
                                  }
                                }}
                                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                  isExcluded ? "bg-red-600 text-white hover:bg-red-700" : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                                }`}
                              >
                                {isExcluded ? "Excluded" : "Included"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Verify Reports Section */}
                    <div className="border-t border-gray-700 pt-4">
                      <div className="flex items-center gap-4 mb-4 flex-wrap">
                        <button onClick={() => handleVerifyReports(selectedGuild.id)} className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700">
                          Verify Reports
                        </button>
                        <button onClick={() => handleManageReports(selectedGuild.id)} className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700">
                          Manage Reports
                        </button>
                        <button onClick={() => handleQueueRescan(selectedGuild.id, selectedGuild.name)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                          {selectedGuild.wclStatus === "not_found" ? "Rescan via Raider.IO" : "Queue Full Rescan"}
                        </button>
                        <button
                          onClick={() => handleQueueRescanDeaths(selectedGuild.id, selectedGuild.name)}
                          className="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700"
                        >
                          Rescan Deaths
                        </button>
                        <button
                          onClick={() => handleQueueRescanCharacters(selectedGuild.id, selectedGuild.name)}
                          className="px-4 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-700"
                        >
                          Rescan Characters
                        </button>
                        <button
                          onClick={() => handleQueueBackfillReportCharacters(selectedGuild.id, selectedGuild.name)}
                          className="px-4 py-2 bg-sky-600 text-white rounded hover:bg-sky-700"
                        >
                          Backfill Report Characters
                        </button>
                        <button
                          onClick={() => handleRecalculateStats(selectedGuild.id, selectedGuild.name)}
                          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                        >
                          Recalculate Stats
                        </button>
                        <button onClick={handleEditGuildClick} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">
                          Edit Guild
                        </button>
                        <button
                          onClick={() => handleDeleteGuildClick(selectedGuild.id, selectedGuild.name)}
                          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                          disabled={deleteGuildLoading}
                        >
                          {deleteGuildLoading ? "Loading..." : "Delete Guild"}
                        </button>
                      </div>

                      {verifyResult && (
                        <div className={`rounded-lg p-4 ${verifyResult.isComplete ? "bg-green-900/50" : verifyResult.error ? "bg-red-900/50" : "bg-amber-900/50"}`}>
                          <h5 className="font-medium text-white mb-2">Verification Result</h5>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-gray-400">Stored Reports:</span>
                              <span className="ml-2 text-white">{verifyResult.storedReportCount}</span>
                            </div>
                            <div>
                              <span className="text-gray-400">WCL Reports:</span>
                              <span className="ml-2 text-white">{verifyResult.wclReportCount ?? "Error"}</span>
                            </div>
                            {verifyResult.missingFromSample !== undefined && (
                              <div>
                                <span className="text-gray-400">Missing (sample):</span>
                                <span className={`ml-2 ${verifyResult.missingFromSample > 0 ? "text-red-400" : "text-green-400"}`}>{verifyResult.missingFromSample}</span>
                              </div>
                            )}
                            {verifyResult.hasMorePages !== undefined && (
                              <div>
                                <span className="text-gray-400">More pages:</span>
                                <span className="ml-2 text-white">{verifyResult.hasMorePages ? "Yes" : "No"}</span>
                              </div>
                            )}
                          </div>
                          <p className={`mt-2 ${verifyResult.isComplete ? "text-green-300" : verifyResult.error ? "text-red-300" : "text-amber-300"}`}>{verifyResult.message}</p>
                          {verifyResult.missingReportCodes && verifyResult.missingReportCodes.length > 0 && (
                            <div className="mt-2">
                              <span className="text-gray-400 text-sm">Missing codes: </span>
                              <span className="text-red-300 text-sm">{verifyResult.missingReportCodes.join(", ")}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-red-400">Failed to load guild details</div>
                )}
              </div>
            </div>
          </div>
        )}

        {showAddLogSourceModal && selectedGuild && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-lg rounded-xl bg-gray-800 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-balance text-xl font-bold text-white">Add historical log source</h2>
                  <p className="mt-1 text-pretty text-sm text-gray-400">
                    Add another Warcraft Logs guild identity to {selectedGuild.name}. If it already exists as a tracked guild, use Convert existing guild instead.
                  </p>
                </div>
                <button
                  onClick={() => setShowAddLogSourceModal(false)}
                  aria-label="Close"
                  className="min-h-10 min-w-10 rounded-lg text-2xl text-gray-400 transition-[scale,background-color] hover:bg-gray-700 hover:text-white active:scale-[0.96]"
                >
                  ×
                </button>
              </div>

              <form
                className="mt-5 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddLogSource();
                }}
              >
                <label className="block">
                  <span className="text-sm text-gray-300">Warcraft Logs guild name</span>
                  <input
                    value={addLogSourceForm.name}
                    onChange={(event) => setAddLogSourceForm({ ...addLogSourceForm, name: event.target.value })}
                    className="mt-1 min-h-10 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-400"
                    autoFocus
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                  <label className="block">
                    <span className="text-sm text-gray-300">Realm</span>
                    <input
                      value={addLogSourceForm.realm}
                      onChange={(event) => setAddLogSourceForm({ ...addLogSourceForm, realm: event.target.value })}
                      className="mt-1 min-h-10 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-gray-300">Region</span>
                    <select
                      value={addLogSourceForm.region}
                      onChange={(event) => setAddLogSourceForm({ ...addLogSourceForm, region: event.target.value })}
                      className="mt-1 min-h-10 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-400"
                    >
                      {['EU', 'US', 'KR', 'TW', 'CN'].map((region) => (
                        <option key={region} value={region}>{region}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-gray-900/70 p-3">
                  <input
                    type="checkbox"
                    checked={addLogSourceForm.queueInitialScan}
                    onChange={(event) => setAddLogSourceForm({ ...addLogSourceForm, queueInitialScan: event.target.checked })}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-white">Queue initial full scan</span>
                    <span className="block text-pretty text-xs text-gray-400">Recommended unless this source will be scanned later during a quieter period.</span>
                  </span>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddLogSourceModal(false)}
                    className="min-h-10 rounded-lg bg-gray-700 px-4 py-2 text-white transition-[scale,background-color] hover:bg-gray-600 active:scale-[0.96]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={logSourceActionLoading === "add"}
                    className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition-[scale,background-color] hover:bg-emerald-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {logSourceActionLoading === "add" ? "Adding…" : "Add source"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showMigrateGuildModal && selectedGuild && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-gray-800 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-balance text-xl font-bold text-white">Convert existing guild to a log source</h2>
                  <p className="mt-1 text-pretty text-sm text-gray-400">
                    The selected guild will stop being a separate site guild. Its reports, fights, appearances, VOD links, integrations, and log-source history will move under {selectedGuild.name}.
                  </p>
                </div>
                <button
                  onClick={() => setShowMigrateGuildModal(false)}
                  aria-label="Close"
                  className="min-h-10 min-w-10 rounded-lg text-2xl text-gray-400 transition-[scale,background-color] hover:bg-gray-700 hover:text-white active:scale-[0.96]"
                >
                  ×
                </button>
              </div>

              <div className="mt-5 flex gap-2">
                <input
                  value={migrationSearch}
                  onChange={(event) => setMigrationSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleSearchMigrationGuilds();
                  }}
                  placeholder="Search tracked guilds by name or realm"
                  className="min-h-10 flex-1 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-400"
                />
                <button
                  onClick={() => void handleSearchMigrationGuilds()}
                  disabled={migrationLoading}
                  className="min-h-10 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-[scale,background-color] hover:bg-blue-500 active:scale-[0.96] disabled:opacity-50"
                >
                  Search
                </button>
              </div>

              <div className="mt-3 max-h-44 space-y-1 overflow-y-auto rounded-lg bg-gray-900/70 p-2">
                {migrationCandidates.length === 0 ? (
                  <p className="p-3 text-sm text-gray-400">No candidate guilds found.</p>
                ) : (
                  migrationCandidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      onClick={() => void handleSelectMigrationGuild(candidate)}
                      className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-[scale,background-color] active:scale-[0.99] ${
                        migrationCandidate?.id === candidate.id ? "bg-violet-700 text-white" : "text-gray-200 hover:bg-gray-700"
                      }`}
                    >
                      <span className="font-medium">{candidate.name}</span>
                      <span className="text-sm opacity-75">{candidate.realm} · {candidate.region}</span>
                    </button>
                  ))
                )}
              </div>

              {migrationLoading && migrationCandidate && !migrationPreview && <p className="mt-4 text-sm text-gray-400">Checking stored data and migration blockers…</p>}

              {migrationPreview && (
                <div className="mt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["Reports", migrationPreview.counts.reports],
                      ["Fights", migrationPreview.counts.fights],
                      ["Appearances", migrationPreview.counts.appearances],
                      ["VOD links", migrationPreview.counts.vodLinks],
                    ].map(([label, count]) => (
                      <div key={String(label)} className="rounded-lg bg-gray-900/70 p-3">
                        <span className="block text-xs text-gray-400">{label}</span>
                        <span className="block text-lg font-semibold tabular-nums text-white">{Number(count).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>

                  {migrationPreview.blockers.length > 0 && (
                    <div className="rounded-lg bg-red-950/70 p-3">
                      <h3 className="font-medium text-red-200">Migration blocked</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-pretty text-sm text-red-300">
                        {migrationPreview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                      </ul>
                    </div>
                  )}

                  {migrationPreview.warnings.length > 0 && (
                    <div className="rounded-lg bg-amber-950/60 p-3">
                      <h3 className="font-medium text-amber-200">What will be rebuilt or removed</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-pretty text-sm text-amber-300">
                        {migrationPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  )}

                  {migrationPreview.canMigrate && (
                    <label className="block rounded-lg bg-gray-900/70 p-3">
                      <span className="text-pretty text-sm text-gray-300">
                        This operation uses a database transaction and deletes the separate guild record. Type <strong className="text-white">{migrationPreview.confirmationText}</strong> to confirm.
                      </span>
                      <input
                        value={migrationConfirmation}
                        onChange={(event) => setMigrationConfirmation(event.target.value)}
                        className="mt-3 min-h-10 w-full rounded-lg border border-gray-600 bg-gray-950 px-3 py-2 text-white outline-none focus:border-red-400"
                      />
                    </label>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowMigrateGuildModal(false)}
                      className="min-h-10 rounded-lg bg-gray-700 px-4 py-2 text-white transition-[scale,background-color] hover:bg-gray-600 active:scale-[0.96]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleMigrateGuildToLogSource()}
                      disabled={!migrationPreview.canMigrate || migrationConfirmation !== migrationPreview.confirmationText || migrationLoading}
                      className="min-h-10 rounded-lg bg-red-600 px-4 py-2 font-medium text-white transition-[scale,background-color] hover:bg-red-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {migrationLoading ? "Migrating…" : "Convert and merge data"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Report Management Modal */}
        {showReportManagement && selectedGuild && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4">
            <div className="bg-gray-800 rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
                <h2 className="text-xl font-bold text-white">
                  Reports — {selectedGuild.name}
                  {guildReports && <span className="ml-2 text-gray-400 text-base font-normal">({guildReports.totalReports} total)</span>}
                </h2>
                <button
                  onClick={() => {
                    setShowReportManagement(false);
                    setGuildReports(null);
                    setReportDeleteConfirm(null);
                    setManualReportCode("");
                    setManualReportSourceId("");
                  }}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-4">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleImportReport(selectedGuild.id);
                  }}
                  className="mb-4 rounded-lg border border-gray-700 bg-gray-900/40 p-3"
                >
                  <label className="block text-sm font-medium text-gray-300 mb-2">Add WCL Report</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={manualReportCode}
                      onChange={(event) => setManualReportCode(event.target.value)}
                      placeholder="Report code"
                      className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none disabled:opacity-60"
                      disabled={manualReportImporting}
                    />
                    <select
                      value={manualReportSourceId}
                      onChange={(event) => setManualReportSourceId(event.target.value)}
                      disabled={manualReportImporting}
                      aria-label="Warcraft Logs source"
                      className="min-h-10 rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none disabled:opacity-60"
                    >
                      {selectedGuild.logSources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name} · {source.realm}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={manualReportImporting || !manualReportCode.trim()}
                      className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {manualReportImporting ? "Adding..." : "Add Report"}
                    </button>
                  </div>
                </form>
                {reportsLoading ? (
                  <div className="text-center py-8 text-gray-400">Loading reports...</div>
                ) : guildReports ? (
                  guildReports.raids.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">No reports found for this guild.</div>
                  ) : (
                    <div className="space-y-6">
                      {guildReports.raids.map((raidGroup) => (
                        <div key={raidGroup.zoneId} className="border border-gray-700 rounded-lg overflow-hidden">
                          {/* Raid Header */}
                          <div className="bg-gray-700 px-4 py-3 flex items-center justify-between">
                            <h3 className="text-white font-semibold">{raidGroup.raidName}</h3>
                            <span className="text-gray-400 text-sm">{raidGroup.reports.length} reports</span>
                          </div>

                          {/* Reports Table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-700/50 text-gray-400 text-left">
                                  <th className="px-4 py-2">Report Code</th>
                                  <th className="px-4 py-2">Date</th>
                                  <th className="px-4 py-2 text-center">Fights</th>
                                  <th className="px-4 py-2 text-center">Normal</th>
                                  <th className="px-4 py-2 text-center">Heroic</th>
                                  <th className="px-4 py-2 text-center">Mythic</th>
                                  <th className="px-4 py-2 text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {raidGroup.reports.map((report) => {
                                  const normalFights = report.fightsByDifficulty["3"];
                                  const heroicFights = report.fightsByDifficulty["4"];
                                  const mythicFights = report.fightsByDifficulty["5"];
                                  const reportDate = new Date(report.startTime).toLocaleDateString("en-GB", {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  });
                                  const isConfirming = reportDeleteConfirm?.id === report.id;
                                  const isDeleting = deletingReportId === report.id;

                                  return (
                                    <tr key={report.id} className="border-t border-gray-700 hover:bg-gray-700/30">
                                      <td className="px-4 py-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <a
                                            href={`https://www.warcraftlogs.com/reports/${report.code}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="truncate text-amber-400 hover:text-amber-300 underline"
                                          >
                                            {report.code}
                                          </a>
                                          {report.importSource === "manual_admin" && <span className="shrink-0 rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">Manual</span>}
                                        </div>
                                        {report.sourceGuildSnapshot?.name && (
                                          <div className="mt-1 truncate text-xs text-gray-500">
                                            {report.sourceGuildSnapshot.name} · {report.sourceGuildSnapshot.realm} · {report.sourceGuildSnapshot.region}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-gray-300">{reportDate}</td>
                                      <td className="px-4 py-2 text-center text-white">{report.fightCount}</td>
                                      <td className="px-4 py-2 text-center">
                                        {normalFights ? (
                                          <span className="text-green-400">
                                            {normalFights.kills}/{normalFights.total}
                                          </span>
                                        ) : (
                                          <span className="text-gray-600">—</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        {heroicFights ? (
                                          <span className="text-blue-400">
                                            {heroicFights.kills}/{heroicFights.total}
                                          </span>
                                        ) : (
                                          <span className="text-gray-600">—</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        {mythicFights ? (
                                          <span className="text-purple-400">
                                            {mythicFights.kills}/{mythicFights.total}
                                          </span>
                                        ) : (
                                          <span className="text-gray-600">—</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-right">
                                        {isConfirming ? (
                                          <div className="flex items-center justify-end gap-2">
                                            <span className="text-red-400 text-xs">Delete {report.fightCount} fights?</span>
                                            <button
                                              onClick={() => handleDeleteReport(selectedGuild.id, report.id)}
                                              disabled={isDeleting}
                                              className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                                            >
                                              {isDeleting ? "..." : "Yes"}
                                            </button>
                                            <button onClick={() => setReportDeleteConfirm(null)} className="px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-500">
                                              No
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() =>
                                              setReportDeleteConfirm({
                                                id: report.id,
                                                code: report.code,
                                                fightCount: report.fightCount,
                                              })
                                            }
                                            className="px-2 py-1 bg-red-900/50 text-red-400 text-xs rounded hover:bg-red-900 hover:text-red-300"
                                          >
                                            Delete
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="text-center py-8 text-red-400">Failed to load reports.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Add Guild Modal */}
        {showAddGuildModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h3 className="text-xl font-bold text-white mb-4">Add New Guild</h3>

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Guild Name *</label>
                  <input
                    type="text"
                    value={addGuildForm.name}
                    onChange={(e) => setAddGuildForm({ ...addGuildForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    placeholder="Method"
                    required
                  />
                </div>

                {/* Realm */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Realm *</label>
                  <input
                    type="text"
                    value={addGuildForm.realm}
                    onChange={(e) => setAddGuildForm({ ...addGuildForm, realm: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    placeholder="Tarren Mill"
                    required
                  />
                </div>

                {/* Region */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Region</label>
                  <select
                    value={addGuildForm.region}
                    onChange={(e) => setAddGuildForm({ ...addGuildForm, region: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="eu">EU</option>
                    <option value="us">US</option>
                    <option value="kr">KR</option>
                    <option value="tw">TW</option>
                    <option value="cn">CN</option>
                  </select>
                </div>

                {/* Parent Guild */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Parent Guild (optional)</label>
                  <input
                    type="text"
                    value={addGuildForm.parent_guild}
                    onChange={(e) => setAddGuildForm({ ...addGuildForm, parent_guild: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    placeholder="Main guild name if this is a sub-team"
                  />
                  <p className="text-xs text-gray-500 mt-1">For sub-teams/splits, enter the main guild name</p>
                </div>

                {/* Streamers */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Streamers (optional)</label>
                  <input
                    type="text"
                    value={addGuildForm.streamers}
                    onChange={(e) => setAddGuildForm({ ...addGuildForm, streamers: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    placeholder="streamer1, streamer2, streamer3"
                  />
                  <p className="text-xs text-gray-500 mt-1">Comma-separated Twitch channel names</p>
                </div>

                {/* Form Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleAddGuild}
                    disabled={addGuildLoading || !addGuildForm.name.trim() || !addGuildForm.realm.trim()}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {addGuildLoading ? "Creating..." : "Create Guild"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddGuildModal(false);
                      setAddGuildForm({ name: "", realm: "", region: "eu", parent_guild: "", streamers: "" });
                    }}
                    className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Guild Modal */}
        {showEditGuildModal && editGuildTarget && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h3 className="text-xl font-bold text-white mb-4">Edit Guild: {editGuildTarget.name}</h3>

              <div className="space-y-4">
                {/* Parent Guild */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Parent Guild</label>
                  <input
                    type="text"
                    value={editGuildForm.parent_guild}
                    onChange={(e) => setEditGuildForm({ ...editGuildForm, parent_guild: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    placeholder="Main guild name if this is a sub-team"
                  />
                  <p className="text-xs text-gray-500 mt-1">For sub-teams/splits, enter the main guild name</p>
                </div>

                {/* Streamers */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Streamers</label>
                  <input
                    type="text"
                    value={editGuildForm.streamers}
                    onChange={(e) => setEditGuildForm({ ...editGuildForm, streamers: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    placeholder="streamer1, streamer2, streamer3"
                  />
                  <p className="mt-1 text-xs text-gray-500">Comma-separated admin-managed Twitch channel names</p>
                  {selectedGuild?.streamers?.some((streamer) => streamer.adminManaged === false) && (
                    <div className="mt-3 rounded-lg bg-gray-900/60 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
                      <p className="px-1 pb-1 text-xs text-gray-400 text-pretty">Self-managed streamers are kept when the admin list changes. Remove one entirely only when moderation requires it.</p>
                      <div className="divide-y divide-gray-700/80">
                        {selectedGuild.streamers
                          .filter((streamer) => streamer.adminManaged === false)
                          .map((streamer) => (
                            <div key={streamer.channelName} className="flex min-h-12 items-center justify-between gap-3 px-1 py-1">
                              <span className="truncate text-sm text-gray-200">{streamer.channelName}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveSelfManagedStreamer(streamer.channelName)}
                                disabled={editGuildLoading}
                                className="min-h-10 shrink-0 rounded-md bg-red-950/70 px-3 text-xs font-medium text-red-300 shadow-[0_0_0_1px_rgba(248,113,113,0.25)] transition-transform duration-150 ease-out hover:bg-red-950 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Remove entirely
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Horse Race Uma */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Horse Race Uma</label>
                  <div className="flex items-center gap-3">
                    <select
                      value={editGuildForm.horseRaceUmaImage}
                      onChange={(e) => setEditGuildForm({ ...editGuildForm, horseRaceUmaImage: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">Random</option>
                      {UMA_IMAGES.map((image) => (
                        <option key={image} value={image}>
                          {getUmaImageLabel(image)}
                        </option>
                      ))}
                    </select>
                    {editGuildForm.horseRaceUmaImage && (
                      <img src={`/uma/${editGuildForm.horseRaceUmaImage}`} alt="" className="h-12 w-12 shrink-0 object-contain" aria-hidden="true" />
                    )}
                  </div>
                </div>

                {/* Activity Status */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Activity Status</label>
                  <select
                    value={editGuildForm.activityStatus}
                    onChange={(e) => setEditGuildForm({ ...editGuildForm, activityStatus: e.target.value as "active" | "inactive" })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                {/* Form Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleSaveGuildEdit}
                    disabled={editGuildLoading}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {editGuildLoading ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditGuildModal(false);
                      setEditGuildTarget(null);
                    }}
                    disabled={editGuildLoading}
                    className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Guild Confirmation Modal */}
        {showDeleteGuildModal && deleteGuildPreview && guildToDelete && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 max-w-lg w-full">
              <h3 className="text-xl font-bold text-red-400 mb-4">⚠️ Delete Guild</h3>

              <div className="space-y-4">
                {/* Guild Info */}
                <div className="bg-gray-700 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-2">{deleteGuildPreview.guild.name}</h4>
                  <p className="text-gray-400 text-sm">
                    {deleteGuildPreview.guild.realm} - {deleteGuildPreview.guild.region.toUpperCase()}
                  </p>
                </div>

                {/* What will be deleted */}
                <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
                  <h4 className="text-red-400 font-medium mb-3">The following data will be permanently deleted:</h4>
                  <ul className="space-y-2 text-gray-300 text-sm">
                    <li className="flex justify-between">
                      <span>Reports:</span>
                      <span className="font-medium text-white">{deleteGuildPreview.willBeDeleted.reports}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Fights:</span>
                      <span className="font-medium text-white">{deleteGuildPreview.willBeDeleted.fights}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Events:</span>
                      <span className="font-medium text-white">{deleteGuildPreview.willBeDeleted.events}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Queue Items:</span>
                      <span className="font-medium text-white">{deleteGuildPreview.willBeDeleted.queueItem}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Tier List Entries:</span>
                      <span className="font-medium text-white">{deleteGuildPreview.willBeDeleted.tierListEntries}</span>
                    </li>
                  </ul>
                </div>

                {/* Warning */}
                <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4">
                  <p className="text-amber-300 text-sm">{deleteGuildPreview.warning}</p>
                </div>

                {/* Form Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleConfirmDeleteGuild}
                    disabled={deleteGuildLoading}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deleteGuildLoading ? "Deleting..." : "Confirm Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteGuildModal(false);
                      setDeleteGuildPreview(null);
                      setGuildToDelete(null);
                    }}
                    disabled={deleteGuildLoading}
                    className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

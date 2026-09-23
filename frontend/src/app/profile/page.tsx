"use client";

import { useAuth } from "@/context/AuthContext";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { api, ApiError } from "@/lib/api";
import CharacterSelectorDialog from "@/components/CharacterSelectorDialog";
import BattleNetAccessHelp from "@/components/BattleNetAccessHelp";
import { WoWCharacter, UserProfile, UserPickemEntry, StreamerSettings } from "@/types";
import Link from "next/link";
import { FaBattleNet, FaDiscord, FaTwitch } from "react-icons/fa";

// WoW Class colors
const CLASS_COLORS: { [key: string]: string } = {
  "Death Knight": "#C41E3A",
  "Demon Hunter": "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

export default function ProfilePage() {
  const { user: authUser, isLoading: isAuthLoading, logout } = useAuth();
  const t = useTranslations("profilePage");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Profile data state (fetched separately from auth)
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const profileRequest = useRef(0);

  const [isConnectingTwitch, setIsConnectingTwitch] = useState(false);
  const [isConnectingBattleNet, setIsConnectingBattleNet] = useState(false);
  const [isDisconnectingTwitch, setIsDisconnectingTwitch] = useState(false);
  const [isDisconnectingBattleNet, setIsDisconnectingBattleNet] = useState(false);
  const [isRefreshingCharacters, setIsRefreshingCharacters] = useState(false);
  const [isRefreshingTwitch, setIsRefreshingTwitch] = useState(false);
  const [isSavingCharacters, setIsSavingCharacters] = useState(false);
  const [showCharacterDialog, setShowCharacterDialog] = useState(false);
  const [allCharacters, setAllCharacters] = useState<WoWCharacter[] | null>(null);
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string; code?: string } | null>(null);
  const hasTriggeredRefresh = useRef(false);
  const characterOperation = useRef(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  // Streamer listing state
  const [streamerSettings, setStreamerSettings] = useState<StreamerSettings | null>(null);
  const [isLoadingStreamerSettings, setIsLoadingStreamerSettings] = useState(false);
  const [isSavingStreamerSettings, setIsSavingStreamerSettings] = useState(false);
  const [selectedStreamerGuildId, setSelectedStreamerGuildId] = useState("");

  // Pickems state
  const [userPickems, setUserPickems] = useState<UserPickemEntry[]>([]);
  const [isLoadingPickems, setIsLoadingPickems] = useState(false);
  const [expandedPickemIds, setExpandedPickemIds] = useState<Set<string>>(new Set());

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Fetch profile data
  const refreshProfile = useCallback(async () => {
    const request = ++profileRequest.current;
    try {
      const profileData = await api.getProfile();
      if (request === profileRequest.current) setProfile(profileData);
    } catch (error) {
      console.error("Failed to fetch profile:", error);
      // Keep the last successfully loaded profile available during a temporary failure.
    }
  }, []);

  const refreshStreamerSettings = useCallback(async () => {
    try {
      setIsLoadingStreamerSettings(true);
      const settings = await api.getStreamerSettings();
      setStreamerSettings(settings);
      setSelectedStreamerGuildId(settings.selectedGuildId ?? "");
    } catch (error) {
      console.error("Failed to fetch streamer settings:", error);
      setStreamerSettings(null);
      setSelectedStreamerGuildId("");
    } finally {
      setIsLoadingStreamerSettings(false);
    }
  }, []);

  // Initial profile load
  useEffect(() => {
    if (!isAuthLoading && authUser) {
      setIsLoadingProfile(true);
      void refreshProfile().finally(() => setIsLoadingProfile(false));
      void refreshStreamerSettings();
    }
  }, [isAuthLoading, authUser, refreshProfile, refreshStreamerSettings]);

  // Fetch user's pickem entries
  useEffect(() => {
    if (!isAuthLoading && authUser) {
      setIsLoadingPickems(true);
      api
        .getMyPickems()
        .then(setUserPickems)
        .catch((error) => console.error("Failed to fetch pickems:", error))
        .finally(() => setIsLoadingPickems(false));
    }
  }, [isAuthLoading, authUser]);

  // Leave failures visible until the user takes another action.
  useEffect(() => {
    if (message?.type === "success") {
      const timeout = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timeout);
    }
  }, [message]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthLoading && !authUser) {
      router.push("/");
    }
  }, [authUser, isAuthLoading, router]);

  const handleConnectTwitch = async () => {
    try {
      setIsConnectingTwitch(true);
      const { url } = await api.getTwitchConnectUrl();
      window.location.href = url;
    } catch (error) {
      console.error("Failed to get Twitch connect URL:", error);
      setMessage({ type: "error", text: t("connectionError") });
      setIsConnectingTwitch(false);
    }
  };

  const handleDisconnectTwitch = async () => {
    try {
      setIsDisconnectingTwitch(true);
      await api.disconnectTwitch();
      await refreshProfile();
      await refreshStreamerSettings();
      setMessage({ type: "success", text: t("twitchDisconnected") });
    } catch (error) {
      console.error("Failed to disconnect Twitch:", error);
      setMessage({ type: "error", text: t("disconnectionError") });
    } finally {
      setIsDisconnectingTwitch(false);
    }
  };

  const handleConnectBattleNet = async () => {
    try {
      setIsConnectingBattleNet(true);
      const { url } = await api.getBattleNetConnectUrl();
      window.location.href = url;
    } catch (error) {
      console.error("Failed to get Battle.net connect URL:", error);
      setMessage({ type: "error", text: t("connectionError") });
      setIsConnectingBattleNet(false);
    }
  };

  const handleDisconnectBattleNet = async () => {
    if (characterOperation.current) return;
    characterOperation.current = true;
    try {
      setIsDisconnectingBattleNet(true);
      await api.disconnectBattleNet();
      setAllCharacters(null);
      setShowCharacterDialog(false);
      setNeedsReconnect(false);
      setProfile((current) => current ? { ...current, battlenet: undefined } : current);
      await refreshProfile();
      await refreshStreamerSettings();
      setMessage({ type: "success", text: t("battlenetDisconnected") });
    } catch (error) {
      console.error("Failed to disconnect Battle.net:", error);
      setMessage({ type: "error", text: t("disconnectionError") });
    } finally {
      characterOperation.current = false;
      setIsDisconnectingBattleNet(false);
    }
  };

  const handleRefreshCharacters = useCallback(async () => {
    if (characterOperation.current) return;
    characterOperation.current = true;
    try {
      setMessage(null);
      setIsRefreshingCharacters(true);
      const { characters } = await api.refreshWoWCharacters();
      setAllCharacters(characters);
      setProfile((current) => current?.battlenet ? {
        ...current, battlenet: { ...current.battlenet, characters: characters.filter((character) => character.selected) },
      } : current);
      setNeedsReconnect(false);
      await Promise.all([refreshProfile(), refreshStreamerSettings()]);
      setMessage({ type: "success", text: t("charactersRefreshed") });
    } catch (error) {
      console.error("Failed to refresh characters:", error);
      const reconnect = error instanceof ApiError && error.code === "BATTLENET_RECONNECT_REQUIRED";
      if (reconnect) setNeedsReconnect(true);
      const code = error instanceof ApiError ? error.code?.toLowerCase() : undefined;
      setMessage({ type: "error", code, text: t(code && t.has(code) ? code : reconnect ? "reconnectRequired" : "refreshError") });
    } finally {
      characterOperation.current = false;
      setIsRefreshingCharacters(false);
    }
  }, [refreshProfile, refreshStreamerSettings, t]);

  const handleRefreshTwitch = async () => {
    try {
      setIsRefreshingTwitch(true);
      await refreshProfile();
      setMessage({ type: "success", text: "Twitch data refreshed!" });
    } catch (error) {
      console.error("Failed to refresh Twitch:", error);
      setMessage({ type: "error", text: "Failed to refresh Twitch data." });
    } finally {
      setIsRefreshingTwitch(false);
    }
  };

  const handleSaveCharacters = async (selectedIds: number[]) => {
    if (characterOperation.current) return;
    characterOperation.current = true;
    try {
      setMessage(null);
      setIsSavingCharacters(true);
      const { characters } = await api.updateCharacterSelection(selectedIds);
      const selected = new Set(selectedIds);
      setAllCharacters((current) => current?.map((character) => ({ ...character, selected: selected.has(character.id) })) ?? null);
      setProfile((current) => current?.battlenet ? { ...current, battlenet: { ...current.battlenet, characters } } : current);
      await Promise.all([refreshProfile(), refreshStreamerSettings()]);
      setMessage({ type: "success", text: t("charactersSaved") });
      setShowCharacterDialog(false);
    } catch (error) {
      console.error("Failed to save character selection:", error);
      setMessage({ type: "error", text: t("saveError") });
    } finally {
      characterOperation.current = false;
      setIsSavingCharacters(false);
    }
  };

  const handleOpenCharacterDialog = useCallback(async () => {
    if (allCharacters === null && characterOperation.current) return;
    setShowCharacterDialog(true);
    if (allCharacters !== null || characterOperation.current) return;
    characterOperation.current = true;
    try {
      setIsLoadingCharacters(true);
      const { characters } = await api.getAllWoWCharacters();
      setAllCharacters(characters);
    } catch (error) {
      console.error("Failed to fetch characters:", error);
      setMessage({ type: "error", text: t("refreshError") });
      setShowCharacterDialog(false);
    } finally {
      characterOperation.current = false;
      setIsLoadingCharacters(false);
    }
  }, [allCharacters, t]);

  // Wait for the connected profile before consuming the callback parameters.
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (hasTriggeredRefresh.current) return;
    if (connected === "battlenet") {
      if (!profile?.battlenet || isLoadingProfile) return;
      hasTriggeredRefresh.current = true;
      setMessage({ type: "success", text: t("battlenetConnected") });
      void handleOpenCharacterDialog();
    } else if (connected === "twitch") {
      hasTriggeredRefresh.current = true;
      setMessage({ type: "success", text: t("twitchConnected") });
    } else if (error) {
      hasTriggeredRefresh.current = true;
      const errorKey = error.startsWith("battlenet_") && t.has(error) ? error
        : error === "battlenet_already_linked" ? "battlenetAlreadyLinked"
        : error === "twitch_already_linked" ? "twitchAlreadyLinked"
        : error === "battlenet_failed" ? "battlenetConnectionFailed"
        : error === "twitch_failed" ? "twitchConnectionFailed" : "connectionError";
      setMessage({ type: "error", text: t(errorKey), code: error });
    } else return;
    router.replace("/profile");
  }, [searchParams, profile?.battlenet, isLoadingProfile, handleOpenCharacterDialog, router, t]);

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;

    try {
      setIsDeletingAccount(true);
      await api.deleteMyAccount();
      setMessage({ type: "success", text: t("deleteAccountSuccess") });
      setShowDeleteConfirm(false);
      router.push("/");
    } catch (error) {
      console.error("Failed to delete account:", error);
      setMessage({ type: "error", text: t("deleteAccountError") });
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleSaveStreamerSettings = async () => {
    try {
      setIsSavingStreamerSettings(true);
      const settings = await api.updateStreamerSettings(selectedStreamerGuildId || null);
      setStreamerSettings(settings);
      setSelectedStreamerGuildId(settings.selectedGuildId ?? "");
      setMessage({ type: "success", text: settings.selectedGuildId ? t("streamerSettingsSaved") : t("streamerSettingsRemoved") });
    } catch (error) {
      console.error("Failed to update streamer settings:", error);
      const errorMessage = error instanceof Error ? error.message : t("streamerSettingsError");
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setIsSavingStreamerSettings(false);
    }
  };

  const togglePickemExpanded = (pickemId: string) => {
    setExpandedPickemIds((current) => {
      const next = new Set(current);
      if (next.has(pickemId)) {
        next.delete(pickemId);
      } else {
        next.add(pickemId);
      }
      return next;
    });
  };

  const getClassColor = (className: string): string => {
    return CLASS_COLORS[className] || "#FFFFFF";
  };

  const getFactionColor = (faction: WoWCharacter["faction"]): string => {
    return faction === "ALLIANCE" ? "#3B82F6" : faction === "HORDE" ? "#EF4444" : "#9CA3AF";
  };

  // Show loading while checking auth or loading profile
  if (isAuthLoading || isLoadingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated
  if (!authUser) return null;
  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-white">
        <p>{t("profileLoadError")}</p>
        <button
          onClick={() => {
            setIsLoadingProfile(true);
            void refreshProfile().finally(() => setIsLoadingProfile(false));
          }}
          className="px-4 py-2 bg-blue-600 rounded-md"
        >
          {t("refresh")}
        </button>
      </div>
    );
  }
  const isCharacterBusy = isRefreshingCharacters || isSavingCharacters || isLoadingCharacters || isDisconnectingBattleNet;

  const selectedCharacters = profile.battlenet?.characters.filter((c) => c.selected) || [];

  return (
    <main className="min-h-screen px-4 md:px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">{t("title")}</h1>

        {/* Status Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.type === "success" ? "bg-green-900/50 border border-green-500 text-green-200" : "bg-red-900/50 border border-red-500 text-red-200"
            }`}
          >
            {message.text}
            <BattleNetAccessHelp code={message.code} />
          </div>
        )}

        {/* Profile Card */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <img src={profile.discord.avatarUrl} alt={profile.discord.username} className="w-16 h-16 rounded-full border-2 border-indigo-500" />
              <div className="min-w-0">
                <h2 className="text-2xl font-bold text-white truncate">{profile.discord.username}</h2>
              </div>
            </div>
            <button onClick={logout} className="shrink-0 flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors text-sm font-medium">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                  clipRule="evenodd"
                />
              </svg>
              {t("logout")}
            </button>
          </div>

          <div className="border-t border-gray-700 pt-4 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-900/40 rounded-md border border-gray-700 px-4 py-3">
              <label className="text-sm text-gray-400">{t("memberSince")}</label>
              <p className="text-white">
                {new Date(profile.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <div className="bg-gray-900/40 rounded-md border border-gray-700 px-4 py-3">
              <label className="text-sm text-gray-400">{t("lastLogin")}</label>
              <p className="text-white">
                {new Date(profile.lastLoginAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Connected Accounts Section */}
        <div className="mt-8 bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h3 className="text-xl font-bold text-white mb-6">{t("connectedAccounts")}</h3>

          {/* Twitch Connection */}
          <div className="mb-6 pb-6 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {profile.twitch && profile.twitch.profileImageUrl ? (
                  <img src={profile.twitch.profileImageUrl} alt={profile.twitch.displayName} className="w-12 h-12 rounded-full border-2 border-purple-500" />
                ) : (
                  <FaTwitch className="w-8 h-8 text-purple-500" />
                )}
                <div>
                  <h4 className="text-white font-medium">{t("twitchAccount")}</h4>
                  {profile.twitch ? <p className="text-purple-400 text-sm">{profile.twitch.displayName}</p> : <p className="text-gray-500 text-sm">{t("notConnected")}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                {profile.twitch ? (
                  <>
                    <button
                      onClick={handleRefreshTwitch}
                      disabled={isRefreshingTwitch}
                      className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      <svg className={`w-4 h-4 ${isRefreshingTwitch ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      {t("refresh")}
                    </button>
                    <button
                      onClick={handleDisconnectTwitch}
                      disabled={isDisconnectingTwitch}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors text-sm disabled:opacity-50"
                    >
                      {isDisconnectingTwitch ? t("disconnecting") : t("disconnect")}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleConnectTwitch}
                    disabled={isConnectingTwitch}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors text-sm disabled:opacity-50"
                  >
                    {isConnectingTwitch ? t("connecting") : t("connect")}
                  </button>
                )}
              </div>
            </div>
            {profile.twitch && (
              <p className="text-gray-500 text-xs mt-2">
                {t("connectedOn")}{" "}
                {new Date(profile.twitch.connectedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            )}
          </div>

          {/* Battle.net Connection */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FaBattleNet className="w-8 h-8 text-blue-400" />
                <div>
                  <h4 className="text-white font-medium">{t("battlenetAccount")}</h4>
                  {profile.battlenet ? <p className="text-blue-400 text-sm">{profile.battlenet.battletag}</p> : <p className="text-gray-500 text-sm">{t("notConnected")}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                {profile.battlenet ? (
                  <>
                    {(needsReconnect || profile.battlenet.needsReconnect) && (
                      <button onClick={handleConnectBattleNet} disabled={isCharacterBusy || isConnectingBattleNet} className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50">
                        {isConnectingBattleNet ? t("connecting") : t("reconnect")}
                      </button>
                    )}
                    <button
                      onClick={handleRefreshCharacters}
                      disabled={isCharacterBusy}
                      className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      <svg className={`w-4 h-4 ${isRefreshingCharacters ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      {t("refresh")}
                    </button>
                    <button
                      onClick={handleDisconnectBattleNet}
                      disabled={isCharacterBusy}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors text-sm disabled:opacity-50"
                    >
                      {isDisconnectingBattleNet ? t("disconnecting") : t("disconnect")}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleConnectBattleNet}
                    disabled={isConnectingBattleNet}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm disabled:opacity-50"
                  >
                    {isConnectingBattleNet ? t("connecting") : t("connect")}
                  </button>
                )}
              </div>
            </div>
            {profile.battlenet && (
              <p className="text-gray-500 text-xs mt-2">
                {t("connectedOn")}{" "}
                {new Date(profile.battlenet.connectedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            )}
          </div>
        </div>

        {/* Discord Bot Section */}
        <div className="mt-8 bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#5865F2]/15 text-[#AAB4FF]">
                <FaDiscord className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">{t("discordBot")}</h3>
                <p className="mt-1 text-sm text-gray-400">{t("discordBotDescription")}</p>
              </div>
            </div>
            <Link
              href="/profile/discord"
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 active:scale-[0.96]"
            >
              {t("manageDiscordBot")}
            </Link>
          </div>
        </div>

        {/* WoW Characters Section */}
        {profile.battlenet && (
          <div className="mt-8 bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">{t("wowCharacters")}</h3>
              <button onClick={handleOpenCharacterDialog} disabled={isDisconnectingBattleNet} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium">
                {t("editCharacters")}
              </button>
            </div>

            {selectedCharacters.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-4">{t("noCharactersSelected")}</p>
                <button onClick={handleOpenCharacterDialog} disabled={isDisconnectingBattleNet} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium">
                  {t("selectCharactersDescription")}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedCharacters.map((character) => (
                  <div
                    key={`${character.id}-${character.name}-${character.realm}`}
                    className="bg-gray-700/50 rounded-lg p-4 border border-gray-600 hover:border-gray-500 transition-all hover:bg-gray-700 flex items-center justify-between"
                  >
                    <div className="flex items-center min-w-0">
                      <span className="font-bold text-lg truncate" style={{ color: getClassColor(character.class) }}>
                        {character.name}
                      </span>
                      <span className="text-white font-normal text-sm truncate">-{character.realm}</span>
                      {character.inactive ? (
                        <span className="text-red-500 text-sm ml-2 truncate">&lt;inactive&gt;</span>
                      ) : (
                        character.guild && <span className="text-yellow-400 text-sm ml-2 truncate">&lt;{character.guild}&gt;</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm flex-nowrap">
                      <span className="text-white">Level {character.level}</span>
                      <span style={{ color: getFactionColor(character.faction) }}>{character.race}</span>
                      <span style={{ color: getClassColor(character.class) }}>{character.class}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {profile.battlenet.lastCharacterSync && (
              <p className="text-gray-500 text-xs mt-4">
                {t("lastSynced")}{" "}
                {new Date(profile.battlenet.lastCharacterSync).toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
        )}

        {/* Guild Streamer Listing */}
        <div className="mt-8 bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="mb-5">
            <h3 className="text-xl font-bold text-white">{t("streamerListing")}</h3>
            <p className="text-gray-400 text-sm mt-2">{t("streamerListingDescription")}</p>
          </div>

          {isLoadingStreamerSettings ? (
            <div className="text-gray-400 py-4">Loading...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                <div className={`rounded-md border px-3 py-2 ${streamerSettings?.requirements.hasTwitch ? "border-green-700 bg-green-950/30" : "border-gray-700 bg-gray-900/40"}`}>
                  <div className="text-xs text-gray-400">{t("linkTwitch")}</div>
                  <div className={streamerSettings?.requirements.hasTwitch ? "text-green-300 text-sm font-medium" : "text-gray-500 text-sm"}>{streamerSettings?.requirements.hasTwitch ? t("connected") : t("notConnected")}</div>
                </div>
                <div className={`rounded-md border px-3 py-2 ${streamerSettings?.requirements.hasBattleNet ? "border-green-700 bg-green-950/30" : "border-gray-700 bg-gray-900/40"}`}>
                  <div className="text-xs text-gray-400">{t("linkBattleNet")}</div>
                  <div className={streamerSettings?.requirements.hasBattleNet ? "text-green-300 text-sm font-medium" : "text-gray-500 text-sm"}>{streamerSettings?.requirements.hasBattleNet ? t("connected") : t("notConnected")}</div>
                </div>
                <div className={`rounded-md border px-3 py-2 ${streamerSettings?.requirements.hasSelectedCharacter ? "border-green-700 bg-green-950/30" : "border-gray-700 bg-gray-900/40"}`}>
                  <div className="text-xs text-gray-400">{t("manageCharacters")}</div>
                  <div className={streamerSettings?.requirements.hasSelectedCharacter ? "text-green-300 text-sm font-medium" : "text-gray-500 text-sm"}>
                    {streamerSettings?.requirements.hasSelectedCharacter ? t("charactersSelected") : t("noCharactersSelected")}
                  </div>
                </div>
              </div>

              {streamerSettings && streamerSettings.eligibleGuilds.length > 0 ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={selectedStreamerGuildId}
                    onChange={(event) => setSelectedStreamerGuildId(event.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="">{t("doNotShowAsStreamer")}</option>
                    {streamerSettings.eligibleGuilds.map((guild) => (
                      <option key={guild.id} value={guild.id}>
                        {guild.name} - {guild.realm}
                        {guild.parent_guild ? ` (${guild.parent_guild})` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleSaveStreamerSettings}
                    disabled={isSavingStreamerSettings || selectedStreamerGuildId === (streamerSettings.selectedGuildId ?? "")}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingStreamerSettings ? t("saving") : t("saveStreamerSettings")}
                  </button>
                </div>
              ) : (
                <div className="bg-gray-900/40 border border-gray-700 rounded-md px-4 py-3 text-gray-400 text-sm">{t("streamerListingUnavailable")}</div>
              )}
            </>
          )}
        </div>

        {/* My Pickems Section */}
        <div className="mt-8 bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h3 className="text-xl font-bold text-white mb-4">{t("myPickems")}</h3>

          {isLoadingPickems ? (
            <div className="text-gray-400 py-4">Loading...</div>
          ) : userPickems.length === 0 ? (
            <p className="text-gray-400 py-4">{t("noPickems")}</p>
          ) : (
            <div className="space-y-4">
              {userPickems.map((entry) => (
                <div key={entry.pickemId} className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                  <div className="flex items-center justify-between gap-3">
                    <button onClick={() => togglePickemExpanded(entry.pickemId)} className="flex items-center gap-3 min-w-0 text-left">
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedPickemIds.has(entry.pickemId) ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <div className="min-w-0">
                        <h4 className="text-white font-medium truncate">{entry.pickemName ?? entry.pickemId}</h4>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          {entry.type && <span className="uppercase">{entry.type}</span>}
                          <span>{t("predictionsCount", { count: entry.predictions.length })}</span>
                        </div>
                      </div>
                    </button>
                    <Link href={`/pickems/${entry.pickemId}`} className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors text-sm">
                      {t("viewPickem")}
                    </Link>
                  </div>

                  {expandedPickemIds.has(entry.pickemId) && (
                    <>
                      <div className="overflow-x-auto mt-4">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-600">
                              <th className="text-left py-1 pr-4">{t("position")}</th>
                              <th className="text-left py-1">{t("guild")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...entry.predictions]
                              .sort((a, b) => a.position - b.position)
                              .map((pred) => (
                                <tr key={pred.position} className="border-b border-gray-700/50">
                                  <td className="py-1.5 pr-4 text-yellow-400 font-medium">#{pred.position}</td>
                                  <td className="py-1.5 text-white">
                                    {pred.guildName}
                                    {pred.realm && pred.realm !== "RWF" && <span className="text-gray-400 text-xs ml-1">-{pred.realm}</span>}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-2 flex gap-4 text-xs text-gray-500">
                        <span>
                          {t("submittedAt")}{" "}
                          {new Date(entry.submittedAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span>
                          {t("updatedAt")}{" "}
                          {new Date(entry.updatedAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delete Account Section */}
        <div className="mt-8 bg-gray-800 rounded-lg border border-red-900/50 p-6">
          <h3 className="text-xl font-bold text-red-400 mb-2">{t("deleteAccountTitle")}</h3>
          <p className="text-gray-400 text-sm mb-4">{t("deleteAccountWarning")}</p>
          <ul className="text-gray-400 text-sm mb-6 list-disc list-inside space-y-1">
            <li>{t("deleteAccountData1")}</li>
            <li>{t("deleteAccountData2")}</li>
            <li>{t("deleteAccountData3")}</li>
            <li>{t("deleteAccountData4")}</li>
          </ul>

          {!showDeleteConfirm ? (
            <button onClick={() => setShowDeleteConfirm(true)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors text-sm font-medium">
              {t("deleteAccount")}
            </button>
          ) : (
            <div className="bg-red-950/30 border border-red-800 rounded-lg p-4">
              <label className="block text-sm text-red-300 mb-2">{t("deleteAccountConfirmLabel")}</label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t("deleteAccountConfirmPlaceholder")}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirmText !== "DELETE" || isDeletingAccount}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeletingAccount ? t("deleteAccountDeleting") : t("deleteAccountButton")}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText("");
                  }}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md transition-colors text-sm"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Character Selector Dialog */}
        {showCharacterDialog && profile.battlenet && (
          <CharacterSelectorDialog
            characters={allCharacters ?? []}
            onSave={handleSaveCharacters}
            onCancel={() => setShowCharacterDialog(false)}
            onRefresh={handleRefreshCharacters}
            isRefreshing={isRefreshingCharacters}
            isLoading={isLoadingCharacters || allCharacters === null}
            isSaving={isSavingCharacters}
            errorMessage={message?.type === "error" ? message.text : undefined}
            errorCode={message?.type === "error" ? message.code : undefined}
          />
        )}
      </div>
    </main>
  );
}

import { WoWCharacter } from "@/types";
import { useTranslations } from "next-intl";
import { useState, useMemo } from "react";
import BattleNetAccessHelp from "@/components/BattleNetAccessHelp";

interface CharacterSelectorDialogProps {
  characters: WoWCharacter[];
  onSave: (selectedIds: number[]) => void;
  onCancel: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage?: string;
  errorCode?: string;
}

// WoW Class colors (from official WoW UI)
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

export default function CharacterSelectorDialog({ characters, onSave, onCancel, onRefresh, isRefreshing, isLoading, isSaving, errorMessage, errorCode }: CharacterSelectorDialogProps) {
  const t = useTranslations("characterSelector");
  const [selectionChanges, setSelectionChanges] = useState<Map<number, boolean>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const selectedIds = useMemo(() => new Set(characters
    .filter((character) => selectionChanges.get(character.id) ?? character.selected)
    .map((character) => character.id)), [characters, selectionChanges]);
  const isBusy = isRefreshing || isLoading || isSaving;

  // Filter characters based on search query
  const filteredCharacters = useMemo(() => {
    if (!searchQuery.trim()) return characters;

    const query = searchQuery.toLowerCase();
    return characters.filter(
      (char) =>
        char.name.toLowerCase().includes(query) ||
        char.realm.toLowerCase().includes(query) ||
        char.class.toLowerCase().includes(query) ||
        char.race.toLowerCase().includes(query) ||
        char.level.toString().includes(query) ||
        (char.guild && char.guild.toLowerCase().includes(query)),
    );
  }, [characters, searchQuery]);

  const handleToggle = (charId: number) => {
    setSelectionChanges((previous) => new Map(previous).set(charId, !selectedIds.has(charId)));
  };

  const handleSelectAll = () => {
    setSelectionChanges((previous) => {
      const next = new Map(previous);
      for (const character of filteredCharacters) next.set(character.id, true);
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSelectionChanges(new Map(characters.map((character) => [character.id, false])));
  };

  const handleSave = () => {
    if (!isBusy) onSave(Array.from(selectedIds));
  };

  const getClassColor = (className: string): string => {
    return CLASS_COLORS[className] || "#FFFFFF";
  };

  const getFactionColor = (faction: WoWCharacter["faction"]): string => {
    return faction === "ALLIANCE" ? "#3B82F6" : faction === "HORDE" ? "#EF4444" : "#9CA3AF";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">{t("title")}</h2>
            <button onClick={onCancel} disabled={isSaving} className="text-gray-400 hover:text-white transition-colors" aria-label={t("cancel")}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search and Actions Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full px-4 py-2 pl-10 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSelectAll} disabled={isLoading || isSaving} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium">
                {t("selectAll")}
              </button>
              <button onClick={handleDeselectAll} disabled={isLoading || isSaving} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors text-sm font-medium">
                {t("deselectAll")}
              </button>
              <button
                onClick={onRefresh}
                disabled={isBusy}
                className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <svg className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {isRefreshing ? t("refreshing") : t("refresh")}
              </button>
            </div>
          </div>

          <p className="text-gray-400 text-sm mt-3">{t("selected", { count: selectedIds.size, total: characters.length })}</p>
        </div>

        {/* Character List */}
        <div className="flex-1 overflow-y-auto p-4">
          {(isLoading || isRefreshing) && characters.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <svg className="animate-spin h-8 w-8 mx-auto mb-3 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <p>{t("loading")}</p>
            </div>
          ) : filteredCharacters.length === 0 ? (
            <div className="text-center text-gray-400 py-12">{searchQuery ? t("noResults") : t("noCharacters")}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredCharacters.map((character) => (
                <label
                  key={`${character.id}-${character.name}-${character.realm}`}
                  className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                    selectedIds.has(character.id)
                      ? "bg-gray-700 border-2 border-blue-500 shadow-lg"
                      : "bg-gray-700/50 border-2 border-transparent hover:bg-gray-700 hover:border-gray-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={isLoading || isSaving}
                    checked={selectedIds.has(character.id)}
                    onChange={() => handleToggle(character.id)}
                    className="mt-1 w-5 h-5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    {/* Character Name and Realm */}
                    <div className="mb-0.5">
                      <span className="font-bold text-lg" style={{ color: getClassColor(character.class) }}>
                        {character.name}
                      </span>
                      <span className="text-white font-normal text-sm">-{character.realm}</span>

                      {/* Guild Name or Inactive Status */}
                      {character.inactive ? (
                        <span className="text-red-500 text-sm mb-0.5 truncate ml-2">&lt;inactive&gt;</span>
                      ) : (
                        character.guild && <span className="text-yellow-400 text-sm mb-0.5 truncate ml-2">&lt;{character.guild}&gt;</span>
                      )}
                    </div>

                    {/* Character Details: Level, Race, Class */}
                    <div className="flex items-center gap-1.5 text-sm flex-wrap">
                      <span className="text-white">Level {character.level}</span>
                      <span style={{ color: getFactionColor(character.faction) }}>{character.race}</span>
                      <span style={{ color: getClassColor(character.class) }}>{character.class}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {errorMessage && <div role="alert" className="px-6 py-3 text-red-300">{errorMessage}<BattleNetAccessHelp code={errorCode} /></div>}
        <div className="p-6 border-t border-gray-700 flex justify-end gap-3">
          <button onClick={onCancel} disabled={isSaving} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors font-medium">
            {t("cancel")}
          </button>
          <button onClick={handleSave} disabled={isBusy} className="disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors font-medium">
            {isSaving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

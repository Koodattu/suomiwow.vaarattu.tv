"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { RaidInfo } from "@/types";
import IconImage from "./IconImage";
import { useTranslations } from "next-intl";

interface RaidSelectorProps {
  raids: RaidInfo[];
  selectedRaidId: number | null;
  onRaidSelect: (raidId: number | null) => void;
  showOverall?: boolean;
  compact?: boolean;
}

// Convert expansion name to filename format (lowercase, spaces to hyphens)
function getExpansionIconPath(expansionName: string): string {
  const filename = expansionName.toLowerCase().replace(/\s+/g, "-");
  return `/expansions/${filename}.png`;
}

export default function RaidSelector({ raids, selectedRaidId, onRaidSelect, showOverall = false, compact = false }: RaidSelectorProps) {
  const t = useTranslations("raidSelector");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedRaid = raids.find((r) => r.id === selectedRaidId);
  const isOverallSelected = showOverall && selectedRaidId === null;

  // Group raids by expansion
  const groupedRaids: { [expansion: string]: RaidInfo[] } = {};
  const expansionOrder: string[] = [];

  raids.forEach((raid) => {
    if (!groupedRaids[raid.expansion]) {
      groupedRaids[raid.expansion] = [];
      expansionOrder.push(raid.expansion);
    }
    groupedRaids[raid.expansion].push(raid);
  });

  return (
    <div className="relative w-full sm:w-auto" ref={dropdownRef}>
      <label htmlFor="raid-select" className="text-xs text-gray-400 mb-1 block">
        {t("selectRaid")}
      </label>
      <button
        id="raid-select"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white transition-colors hover:bg-gray-750 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          compact ? "xl:min-w-[340px]" : "sm:min-w-[350px]"
        }`}
      >
        <div className="flex items-center gap-2">
          {selectedRaid?.iconUrl && <IconImage iconFilename={selectedRaid.iconUrl} alt="Raid icon" width={24} height={24} className="rounded" />}
          <span>{isOverallSelected ? t("overall") : selectedRaid?.name || t("selectRaid")}</span>
        </div>
        <svg className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-96 overflow-y-auto">
          {showOverall && (
            <button
              onClick={() => {
                onRaidSelect(null);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-2 text-left hover:bg-gray-700 transition-colors flex items-center gap-2 border-b border-gray-700 ${
                isOverallSelected ? "bg-gray-700" : ""
              }`}
            >
              <span className="font-semibold">{t("overall")}</span>
            </button>
          )}
          {expansionOrder.map((expansion) => (
            <div key={expansion}>
              <div className="px-3 py-2 text-xs font-semibold text-gray-400 bg-gray-900 sticky top-0 flex items-center gap-2">
                <span>{expansion}</span>
                <Image src={getExpansionIconPath(expansion)} alt={`${expansion} icon`} height={25} width={40} />
              </div>
              {groupedRaids[expansion].map((raid) => (
                <button
                  key={raid.id}
                  onClick={() => {
                    onRaidSelect(raid.id);
                    setIsOpen(false);
                  }}
                  className={`w-full px-4 py-2 text-left hover:bg-gray-700 transition-colors flex items-center gap-2 ${raid.id === selectedRaidId ? "bg-gray-700" : ""}`}
                >
                  <IconImage iconFilename={raid.iconUrl} alt={`${raid.name} icon`} width={24} height={24} className="rounded" />
                  <span>{raid.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

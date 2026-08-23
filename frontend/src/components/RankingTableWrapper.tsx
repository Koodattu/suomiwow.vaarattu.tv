"use client";

import type { Boss, CharacterRankingRow, ClassInfo } from "@/types";
import type { ColumnDef } from "@/types/index";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Table } from "./Table";
import IconImage from "./IconImage";
import { formatSpecName, getAllClasses, getClassInfoById, getGuildProfileUrl, getParseColor, getSpecIconUrl } from "@/lib/utils";
import { type PatchPartitionOption } from "@/lib/patch-partitions";
import { Selector } from "./Selector";
import { useTranslations } from "next-intl";

interface RankingTableWrapperProps {
  data: CharacterRankingRow[];
  bosses: Boss[];
  filters: RankingFilters;
  variant?: RankingTableVariant;
  partitionOptions?: PatchPartitionOption[];
  showPartitionSelector?: boolean;
  loading?: boolean;
  error?: string | null;
  pagination?: {
    totalItems: number;
    totalRankedItems?: number;
    totalPages: number;
    currentPage: number;
    pageSize: number;
  };
  onFiltersChange?: (filters: {
    encounterId?: number;
    classId?: number | null;
    specName?: string | null;
    metric?: "dps" | "hps";
    partition?: number | null;
    characterName?: string | null;
    guildName?: string | null;
    page?: number;
  }) => void;
}

export type RankingFilters = {
  encounterId?: number;
  classId?: number | null;
  specName?: string | null;
  metric?: "dps" | "hps";
  partition?: number | null;
  characterName?: string | null;
  guildName?: string | null;
  page?: number;
};

type RankingTableVariant = "rankings" | "mechanics" | "combined";

type ClassSpecSelectorProps = {
  selectedClass: ClassInfo | null;
  selectedSpec: string | null;
  selectedRole: "dps" | "healer" | "tank" | null;
  allClassesLabel: string;
  onClassSelect: (classInfo: ClassInfo) => void;
  onSpecSelect: (classInfo: ClassInfo, specName: string) => void;
  onClear: () => void;
};

type ClassSpecButtonProps = {
  selectedClass: ClassInfo | null;
  selectedSpec: string | null;
  allClassesLabel: string;
  onToggle: () => void;
};

type ClassMenuProps = {
  classes: ClassInfo[];
  selectedRole: "dps" | "healer" | "tank" | null;
  selectedClass: ClassInfo | null;
  selectedSpec: string | null;
  hoveredClass: ClassInfo | null;
  allClassesLabel: string;
  onHoverClass: (classInfo: ClassInfo) => void;
  onClear: () => void;
  onClassSelect: (classInfo: ClassInfo) => void;
  onSpecSelect: (classInfo: ClassInfo, specName: string) => void;
  onMenuEnter: () => void;
  onMenuLeave: () => void;
};

type SpecMenuProps = {
  classInfo: ClassInfo;
  selectedRole: "dps" | "healer" | "tank" | null;
  selectedSpec: string | null;
  onSpecSelect: (classInfo: ClassInfo, specName: string) => void;
  onMenuEnter: () => void;
  onMenuLeave: () => void;
};

type UseHoverMenuOptions = {
  closeDelayMs?: number;
};

function getSelectedIcon(selectedClass: ClassInfo | null, selectedSpec: string | null) {
  if (!selectedClass) return null;
  if (!selectedSpec) return `${selectedClass.iconUrl}.jpg`;
  return getSpecIconUrl(selectedClass.id, selectedSpec) ?? `${selectedClass.iconUrl}.jpg`;
}

function useHoverMenu({ closeDelayMs = 250 }: UseHoverMenuOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredClass, setHoveredClass] = useState<ClassInfo | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimeoutRef.current = window.setTimeout(() => {
      setHoveredClass(null);
      setIsOpen(false);
      closeTimeoutRef.current = null;
    }, closeDelayMs);
  }, [cancelClose, closeDelayMs]);

  const closeMenu = useCallback(() => {
    cancelClose();
    setHoveredClass(null);
    setIsOpen(false);
  }, [cancelClose]);

  const toggleMenu = useCallback(() => {
    setIsOpen((open) => !open);
  }, []);

  return {
    isOpen,
    hoveredClass,
    setHoveredClass,
    toggleMenu,
    closeMenu,
    cancelClose,
    scheduleClose,
  };
}

function ClassSpecButton({ selectedClass, selectedSpec, allClassesLabel, onToggle }: ClassSpecButtonProps) {
  const icon = getSelectedIcon(selectedClass, selectedSpec);
  const label = selectedSpec ? formatSpecName(selectedSpec) : (selectedClass?.name ?? allClassesLabel);

  return (
    <button
      type="button"
      onClick={onToggle}
      className="relative w-full min-h-10 cursor-default rounded-md bg-gray-800 py-2 pl-3 pr-10 text-left text-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm font-bold whitespace-nowrap overflow-hidden"
    >
      <div className="flex items-center gap-3">
        {icon ? (
          <div style={{ width: "22px", height: "22px", position: "relative" }}>
            <IconImage iconFilename={icon} alt={selectedSpec ?? selectedClass?.name ?? "All classes"} fill style={{ objectFit: "cover" }} />
          </div>
        ) : null}
        <span className="font-bold">{label}</span>
      </div>
    </button>
  );
}

function SpecMenu({ classInfo, selectedRole, selectedSpec, onSpecSelect, onMenuEnter, onMenuLeave }: SpecMenuProps) {
  const sortedSpecs = useMemo(() => {
    const roleFilteredSpecs = selectedRole ? classInfo.specs.filter((spec) => spec.role === selectedRole) : classInfo.specs;
    return [...roleFilteredSpecs].sort((a, b) => formatSpecName(a.name).localeCompare(formatSpecName(b.name)));
  }, [classInfo.specs, selectedRole]);

  return (
    <div
      className="absolute left-full top-0 z-30 ml-2 min-w-[220px] rounded-md bg-gray-900 py-2 shadow-xl ring-1 ring-black ring-opacity-30"
      onMouseEnter={onMenuEnter}
      onMouseLeave={onMenuLeave}
    >
      {sortedSpecs.map((spec) => {
        const specLabel = formatSpecName(spec.name);
        const isSelected = selectedSpec === spec.name;
        return (
          <button
            key={spec.name}
            type="button"
            onClick={() => onSpecSelect(classInfo, spec.name)}
            className={`flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${isSelected ? "text-white" : "text-gray-300"} font-bold`}
          >
            <div style={{ width: "22px", height: "22px", position: "relative" }}>
              <IconImage
                iconFilename={getSpecIconUrl(classInfo.id, spec.name) ?? `${classInfo.iconUrl}.jpg`}
                alt={`${classInfo.name} ${specLabel}`}
                fill
                style={{ objectFit: "cover" }}
              />
            </div>
            <span className="font-bold">{specLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

function ClassMenu({
  classes,
  selectedRole,
  selectedClass,
  selectedSpec,
  hoveredClass,
  allClassesLabel,
  onHoverClass,
  onClear,
  onClassSelect,
  onSpecSelect,
  onMenuEnter,
  onMenuLeave,
}: ClassMenuProps) {
  return (
    <div
      className="absolute z-20 mt-1 w-full rounded-md bg-gray-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
      onMouseEnter={onMenuEnter}
      onMouseLeave={onMenuLeave}
    >
      <button
        type="button"
        onClick={onClear}
        className="relative flex w-full items-center gap-2 py-2 pl-10 pr-4 text-left text-gray-300 hover:bg-blue-600 hover:text-white font-bold"
      >
        {allClassesLabel}
      </button>
      {classes.map((classInfo) => {
        const isSelected = selectedClass?.id === classInfo.id;
        const isHovered = hoveredClass?.id === classInfo.id;
        return (
          <div key={classInfo.id} className="relative" onMouseEnter={() => onHoverClass(classInfo)}>
            <button
              type="button"
              onClick={() => onClassSelect(classInfo)}
              className={`relative flex w-full items-center gap-2 py-2 pl-10 pr-4 text-left hover:bg-blue-600 hover:text-white ${
                isSelected ? "text-white" : "text-gray-300"
              } font-bold`}
            >
              <div style={{ width: "22px", height: "22px", position: "relative" }}>
                <IconImage iconFilename={`${classInfo.iconUrl}.jpg`} alt={classInfo.name} fill style={{ objectFit: "cover" }} />
              </div>
              {classInfo.name}
            </button>

            {isHovered ? (
              <SpecMenu
                classInfo={classInfo}
                selectedRole={selectedRole}
                selectedSpec={isSelected ? selectedSpec : null}
                onSpecSelect={onSpecSelect}
                onMenuEnter={onMenuEnter}
                onMenuLeave={onMenuLeave}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ClassSpecSelector({ selectedClass, selectedSpec, selectedRole, allClassesLabel, onClassSelect, onSpecSelect, onClear }: ClassSpecSelectorProps) {
  const classes = useMemo(() => {
    const allClasses = getAllClasses();
    const roleFilteredClasses = selectedRole
      ? allClasses
          .map((classInfo) => ({
            ...classInfo,
            specs: classInfo.specs.filter((spec) => spec.role === selectedRole),
          }))
          .filter((classInfo) => classInfo.specs.length > 0)
      : allClasses;

    return [...roleFilteredClasses].sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedRole]);
  const menu = useHoverMenu();

  const handleClassSelect = useCallback(
    (classInfo: ClassInfo) => {
      onClassSelect(classInfo);
      menu.closeMenu();
    },
    [menu, onClassSelect],
  );

  const handleSpecSelect = useCallback(
    (classInfo: ClassInfo, specName: string) => {
      onSpecSelect(classInfo, specName);
      menu.closeMenu();
    },
    [menu, onSpecSelect],
  );

  const handleClear = useCallback(() => {
    onClear();
    menu.closeMenu();
  }, [menu, onClear]);

  return (
    <div className="relative w-full" onMouseEnter={menu.cancelClose} onMouseLeave={menu.scheduleClose}>
      <ClassSpecButton selectedClass={selectedClass} selectedSpec={selectedSpec} allClassesLabel={allClassesLabel} onToggle={menu.toggleMenu} />

      {menu.isOpen ? (
        <ClassMenu
          classes={classes}
          selectedRole={selectedRole}
          selectedClass={selectedClass}
          selectedSpec={selectedSpec}
          hoveredClass={menu.hoveredClass}
          allClassesLabel={allClassesLabel}
          onHoverClass={menu.setHoveredClass}
          onClear={handleClear}
          onClassSelect={handleClassSelect}
          onSpecSelect={handleSpecSelect}
          onMenuEnter={menu.cancelClose}
          onMenuLeave={menu.scheduleClose}
        />
      ) : null}
    </div>
  );
}

type BuildRankingColumnsOptions = {
  selectedBoss: Boss | null;
  bosses: Boss[];
  variant: RankingTableVariant;
  currentPage: number;
  pageSize: number;
  selectedSpec: string | null;
  selectedMetric: "dps" | "hps";
  t: (key: string) => string;
};

function formatScore(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function formatMechanicsEarlyDeaths(row: CharacterRankingRow) {
  const mechanics = row.stats.mechanics;
  if (!mechanics?.deathDataAvailable || mechanics.pulls <= 0) return "—";
  return `${mechanics.earlyDeaths}/${mechanics.pulls}`;
}

function isMechanicsVariant(variant: RankingTableVariant) {
  return variant === "mechanics" || variant === "combined";
}

function getMechanicsScoreValue(row: CharacterRankingRow, variant: RankingTableVariant) {
  if (variant === "mechanics") return row.stats.mechanics?.survivalPercentile;
  return row.score.value;
}

function getMechanicsBossScoreValue(bossScore: NonNullable<CharacterRankingRow["bossScores"]>[number] | undefined, variant: RankingTableVariant) {
  if (variant === "mechanics") return bossScore?.survivalPercentile;
  return bossScore?.score;
}

function buildRankingColumns({ selectedBoss, bosses, variant, currentPage, pageSize, selectedSpec, selectedMetric, t }: BuildRankingColumnsOptions): ColumnDef<CharacterRankingRow>[] {
  const isMechanics = isMechanicsVariant(variant);
  const isSurvival = variant === "mechanics";
  const isShowingDamage = selectedBoss !== null;
  const showIlvl = isShowingDamage;

  const columns: ColumnDef<CharacterRankingRow>[] = [
    {
      id: "rank",
      header: t("columnRank"),
      accessor: (row: CharacterRankingRow) => row.rank,
      shrink: true,
    },
    {
      id: "character",
      header: t("columnName"),
      shrink: true,
      align: "left",
      accessor: (row: CharacterRankingRow) => {
        const realm = row.character.realm;
        const name = row.character.name;
        const wclUrl = `https://www.warcraftlogs.com/character/eu/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`;
        const classIcon = getClassInfoById(row.character.classID)?.iconUrl;
        const roleSpecName = isShowingDamage ? row.context.specName : row.context.bestSpecName ?? row.context.specName;
        const roleSpecIcon = selectedMetric === "hps" && roleSpecName ? getSpecIconUrl(row.character.classID, roleSpecName) : null;
        const primaryIcon = roleSpecIcon ?? classIcon;
        const specIcon = selectedMetric !== "hps" && isShowingDamage && row.context.specName ? getSpecIconUrl(row.character.classID, row.context.specName) : null;

        return (
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div style={{ width: "24px", height: "24px", position: "relative" }}>
                <IconImage iconFilename={primaryIcon} alt={row.character.name} fill style={{ objectFit: "cover" }} />
              </div>
              {specIcon && (
                <div style={{ width: "18px", height: "18px", position: "relative" }}>
                  <IconImage iconFilename={specIcon} alt={row.context.specName!} fill style={{ objectFit: "cover" }} />
                </div>
              )}
              <Link
                href={`/characters/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`}
                className="flex items-center gap-2 transition-colors hover:text-blue-300"
                onClick={(event) => event.stopPropagation()}
              >
                {row.character.name}
              </Link>
            </div>
            <a
              href={wclUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${row.character.name} on Warcraft Logs`}
              className="inline-flex items-center opacity-80 transition-opacity hover:opacity-100"
            >
              <Image src="/wcl-logo.png" alt="Warcraft Logs" width={18} height={18} />
            </a>
          </div>
        );
      },
    },
    {
      id: "guild",
      header: t("columnGuild"),
      shrink: true,
      accessor: (row: CharacterRankingRow) => {
        const guild = row.character.guild;
        if (!guild?.name || !guild?.realm) return "—";
        return (
          <Link href={getGuildProfileUrl(guild.realm, guild.name)} className="hover:text-blue-300 transition-colors" onClick={(event) => event.stopPropagation()}>
            {guild.name}
          </Link>
        );
      },
    },
  ];

  if (showIlvl) {
    columns.push({
      id: "ilvl",
      header: t("columnIlvl"),
      accessor: (row: CharacterRankingRow) => (row.context.ilvl ? row.context.ilvl.toFixed(0) : "—"),
      shrink: true,
      mobileHidden: true,
    });
  }

  columns.push({
    id: "metric",
    header: isSurvival ? t("columnSurvival") : isMechanics ? t("columnCombined") : isShowingDamage ? (selectedMetric === "hps" ? t("columnHps") : t("columnDps")) : t("columnScore"),
    shrink: true,
    accessor: (row: CharacterRankingRow) => {
      if (isMechanics) {
        const value = getMechanicsScoreValue(row, variant);
        const colorValue = value === null || value === undefined ? 0 : Math.round(value);
        return <span style={{ color: getParseColor(colorValue), fontWeight: 700 }}>{formatScore(value)}</span>;
      }
      const value = isShowingDamage ? row.stats.bestAmount?.toFixed(1) : row.stats.allStars?.points?.toFixed(1);
      if (!value) return "—";
      return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    },
  });

  if (isMechanics) {
    columns.push({
      id: "earlyDeaths",
      header: t("columnEarlyDeaths"),
      shrink: true,
      mobileHidden: true,
      accessor: (row: CharacterRankingRow) => <span className="font-semibold tabular-nums text-gray-100">{formatMechanicsEarlyDeaths(row)}</span>,
    });
  }

  // Per-boss rankPercent columns (only in all-bosses AllStars view)
  if (!isShowingDamage && bosses.length > 0) {
    for (const boss of bosses) {
      columns.push({
        id: `boss-${boss.id}`,
        header: (
          <div className="flex justify-center" title={boss.name}>
            <IconImage iconFilename={boss.iconUrl} alt={boss.name} width={24} height={24} className="rounded" />
          </div>
        ),
        shrink: true,
        mobileHidden: true,
        accessor: (row: CharacterRankingRow) => {
          const bossScore = row.bossScores?.find((b) => b.encounterId === boss.id);
          const value = isMechanics ? getMechanicsBossScoreValue(bossScore, variant) : bossScore?.rankPercent;
          if (!bossScore || value === undefined || value === null) return <span className="text-gray-600">—</span>;
          const pct = isMechanics ? Math.round(value) : Math.floor(value);
          const showSpecIcon = !selectedSpec && bossScore.specName;
          const specIcon = showSpecIcon ? getSpecIconUrl(row.character.classID, bossScore.specName!) : null;
          return (
            <span className="inline-flex items-center gap-1" style={{ color: getParseColor(pct), fontWeight: 700 }}>
              {isMechanics ? formatScore(value) : pct}
              {specIcon ? <IconImage iconFilename={specIcon} alt={bossScore.specName!} width={16} height={16} style={{ objectFit: "cover" }} /> : null}
            </span>
          );
        },
      });
    }
  }

  return columns;
}

function MobileBossScores({
  row,
  bosses,
  selectedSpec,
  variant,
}: {
  row: CharacterRankingRow;
  bosses: Boss[];
  selectedSpec: string | null;
  variant: RankingTableVariant;
}) {
  const isMechanics = isMechanicsVariant(variant);

  return (
    <div className="grid grid-cols-2 gap-2">
      {bosses.map((boss) => {
        const bossScore = row.bossScores?.find((b) => b.encounterId === boss.id);
        const value = isMechanics ? getMechanicsBossScoreValue(bossScore, variant) : bossScore?.rankPercent;
        const pct = value !== undefined && value !== null ? (isMechanics ? Math.round(value) : Math.floor(value)) : null;
        const showSpecIcon = !selectedSpec && bossScore?.specName;
        const specIcon = showSpecIcon ? getSpecIconUrl(row.character.classID, bossScore.specName!) : null;

        return (
          <div key={boss.id} className="flex items-center gap-2 rounded bg-gray-800/50 px-2 py-1.5">
            <IconImage iconFilename={boss.iconUrl} alt={boss.name} width={20} height={20} className="rounded shrink-0" />
            <span className="truncate text-xs text-gray-400">{boss.name}</span>
            {pct !== null ? (
              <span className="ml-auto inline-flex items-center gap-1 font-bold text-xs" style={{ color: getParseColor(pct) }}>
                {isMechanics ? formatScore(value) : pct}
                {specIcon ? <IconImage iconFilename={specIcon} alt={bossScore!.specName!} width={14} height={14} style={{ objectFit: "cover" }} /> : null}
              </span>
            ) : (
              <span className="ml-auto text-gray-600 text-xs">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const METRIC_OPTIONS = [
  { value: "dps" as const, label: "DPS", icon: "/icons/roleicon_damage.png" },
  { value: "hps" as const, label: "HPS", icon: "/icons/roleicon_healer.png" },
];

type MetricSelectorProps = {
  selectedMetric: "dps" | "hps";
  onChange: (metric: "dps" | "hps") => void;
};

function MetricSelector({ selectedMetric, onChange }: MetricSelectorProps) {
  const activeOption = METRIC_OPTIONS.find((o) => o.value === selectedMetric) ?? METRIC_OPTIONS[0];

  return (
    <Selector
      items={METRIC_OPTIONS}
      selectedItem={activeOption}
      onChange={(opt) => onChange(opt?.value ?? "dps")}
      nullable={false}
      placeholder="DPS"
      renderButton={(opt) => (
        <div className="flex items-center gap-2">
          <Image src={opt!.icon} alt={opt!.label} width={18} height={18} />
          <span>{opt!.label}</span>
        </div>
      )}
      renderOption={(opt) => (
        <div className="flex items-center gap-2">
          <Image src={opt.icon} alt={opt.label} width={18} height={18} />
          <span>{opt.label}</span>
        </div>
      )}
    />
  );
}

function ClearFilterButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex min-h-10 w-9 shrink-0 items-center justify-center rounded-md border border-red-500/30 bg-red-950/20 text-xl leading-none text-red-300 transition-colors hover:bg-red-950/50 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
    >
      ×
    </button>
  );
}

export function RankingTableWrapper({
  data,
  bosses,
  filters,
  variant = "rankings",
  partitionOptions = [],
  showPartitionSelector = true,
  loading = false,
  error = null,
  pagination,
  onFiltersChange,
}: RankingTableWrapperProps) {
  const t = useTranslations("characterRankingsPage");
  const selectedBoss = useMemo(() => bosses.find((boss) => boss.id === filters.encounterId) ?? null, [bosses, filters.encounterId]);
  const selectedClass = useMemo(() => getAllClasses().find((classInfo) => classInfo.id === filters.classId) ?? null, [filters.classId]);
  const selectedSpec = selectedClass?.specs.some((spec) => spec.name === filters.specName) ? (filters.specName ?? null) : null;
  const selectedPartition = useMemo(
    () => partitionOptions.find((partition) => partition.value === filters.partition) ?? null,
    [filters.partition, partitionOptions],
  );
  const selectedMetric = filters.metric ?? "dps";
  const [searchValue, setSearchValue] = useState(filters.characterName ?? "");
  const [guildSearchValue, setGuildSearchValue] = useState(filters.guildName ?? "");
  const searchDebounceRef = useRef<number | null>(null);
  const guildSearchDebounceRef = useRef<number | null>(null);
  const applyFiltersRef = useRef<(overrides?: Partial<RankingFilters>) => void>(() => undefined);

  const applyFilters = useCallback(
    (overrides: Partial<RankingFilters> = {}) => {
      onFiltersChange?.({
        encounterId: selectedBoss?.id,
        classId: selectedClass?.id ?? null,
        specName: selectedSpec,
        metric: selectedMetric,
        partition: showPartitionSelector ? (selectedPartition?.value ?? null) : filters.partition,
        characterName: searchValue.trim() || null,
        guildName: guildSearchValue.trim() || null,
        page: 1,
        ...overrides,
      });
    },
    [filters.partition, guildSearchValue, onFiltersChange, searchValue, selectedBoss?.id, selectedClass?.id, selectedMetric, selectedPartition?.value, selectedSpec, showPartitionSelector],
  );

  useEffect(() => {
    applyFiltersRef.current = applyFilters;
  }, [applyFilters]);

  useEffect(() => {
    if (searchValue === (filters.characterName ?? "")) return;

    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = window.setTimeout(() => {
      applyFiltersRef.current({
        characterName: searchValue.trim() || null,
        page: 1,
      });
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        window.clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [filters.characterName, searchValue]);

  // Guild name search debounce
  useEffect(() => {
    if (guildSearchValue === (filters.guildName ?? "")) return;

    if (guildSearchDebounceRef.current) {
      window.clearTimeout(guildSearchDebounceRef.current);
    }

    guildSearchDebounceRef.current = window.setTimeout(() => {
      applyFiltersRef.current({
        guildName: guildSearchValue.trim() || null,
        page: 1,
      });
    }, 300);

    return () => {
      if (guildSearchDebounceRef.current) {
        window.clearTimeout(guildSearchDebounceRef.current);
        guildSearchDebounceRef.current = null;
      }
    };
  }, [filters.guildName, guildSearchValue]);

  const handleBossChange = (boss: Boss | null) => {
    applyFilters({ encounterId: boss?.id, page: 1 });
  };

  const handleClassChange = (classInfo: ClassInfo) => {
    applyFilters({ classId: classInfo.id, specName: null, page: 1 });
  };

  const handleSpecSelect = (classInfo: ClassInfo, specName: string) => {
    applyFilters({ classId: classInfo.id, specName, page: 1 });
  };

  const clearClassAndSpec = () => {
    applyFilters({ classId: null, specName: null, page: 1 });
  };

  const handlePartitionChange = (partition: PatchPartitionOption | null) => {
    applyFilters({ partition: partition?.value ?? null, page: 1 });
  };

  const handleMetricChange = (metric: "dps" | "hps") => {
    // When switching to HPS, clear any class/spec selection that isn't a healer
    if (metric === "hps" && selectedClass) {
      const hasHealerSpec = selectedClass.specs.some((spec) => spec.role === "healer");
      const isSpecHealer = selectedSpec ? selectedClass.specs.some((spec) => spec.name === selectedSpec && spec.role === "healer") : false;

      if ((selectedSpec && !isSpecHealer) || (!selectedSpec && !hasHealerSpec)) {
        applyFilters({ metric, classId: null, specName: null, page: 1 });
        return;
      }
    }

    applyFilters({ metric, page: 1 });
  };

  const handlePageChange = (page: number) => {
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (guildSearchDebounceRef.current) {
      window.clearTimeout(guildSearchDebounceRef.current);
      guildSearchDebounceRef.current = null;
    }
    applyFilters({ page });
  };

  const columns = useMemo(() => {
    const currentPage = pagination?.currentPage ?? 1;
    const pageSize = pagination?.pageSize ?? 50;
    return buildRankingColumns({
      selectedBoss,
      bosses,
      variant,
      currentPage,
      pageSize,
      selectedSpec,
      selectedMetric,
      t,
    });
  }, [pagination?.currentPage, pagination?.pageSize, selectedBoss, bosses, variant, selectedSpec, selectedMetric, t]);

  const title =
    variant === "mechanics"
      ? selectedBoss
        ? `${t("titleMechanicsForBoss")} ${selectedBoss.name}`
        : t("titleMechanics")
      : variant === "combined"
        ? selectedBoss
          ? `${t("titleCombinedForBoss")} ${selectedBoss.name}`
          : t("titleCombined")
        : selectedBoss
          ? `${t("titleForBoss")} ${selectedBoss.name}`
          : t("titleAllStars");

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-md border border-red-500/40 bg-red-950/30 px-4 py-3 text-red-200">{error}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <div className="flex flex-wrap gap-3 w-full">
          {/* Character Search */}
          <div className="relative min-w-[160px] flex-1">
            <input
              type="text"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              maxLength={64}
              placeholder={t("searchPlaceholder")}
              className="min-h-10 w-full rounded-md bg-gray-800 py-2 pl-3 pr-10 font-bold text-white shadow-md placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
            />
            {searchValue ? (
              <button
                type="button"
                onClick={() => setSearchValue("")}
                aria-label={t("clearCharacterSearch")}
                title={t("clearCharacterSearch")}
                className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-lg leading-none text-red-300 transition-colors hover:bg-red-950/50 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                ×
              </button>
            ) : null}
          </div>

          {/* Guild Search */}
          <div className="relative min-w-[160px] flex-1">
            <input
              type="text"
              value={guildSearchValue}
              onChange={(event) => setGuildSearchValue(event.target.value)}
              maxLength={64}
              placeholder={t("searchGuildPlaceholder")}
              className="min-h-10 w-full rounded-md bg-gray-800 py-2 pl-3 pr-10 font-bold text-white shadow-md placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
            />
            {guildSearchValue ? (
              <button
                type="button"
                onClick={() => setGuildSearchValue("")}
                aria-label={t("clearGuildSearch")}
                title={t("clearGuildSearch")}
                className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-lg leading-none text-red-300 transition-colors hover:bg-red-950/50 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                ×
              </button>
            ) : null}
          </div>

          {/* Boss Selector */}
          <div className="flex min-w-[160px] flex-1 gap-1.5">
            <div className="min-w-0 flex-1">
              <Selector
                items={bosses}
                selectedItem={selectedBoss}
                onChange={handleBossChange}
                placeholder={t("placeholderAllBosses")}
                renderButton={(boss) => (
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <IconImage iconFilename={boss?.iconUrl} alt={`${boss?.name} icon`} width={24} height={24} />
                    {boss?.name}
                  </div>
                )}
                renderOption={(boss) => (
                  <>
                    <IconImage iconFilename={boss.iconUrl} alt={`${boss.name} icon`} width={24} height={24} />
                    {boss.name}
                  </>
                )}
              />
            </div>
            {selectedBoss ? <ClearFilterButton label={t("clearBoss")} onClick={() => handleBossChange(null)} /> : null}
          </div>

          {/* Class / Spec Selector */}
          <div className="flex min-w-[160px] flex-1 gap-1.5">
            <div className="min-w-0 flex-1">
              <ClassSpecSelector
                selectedClass={selectedClass}
                selectedSpec={selectedSpec}
                selectedRole={selectedMetric === "hps" ? "healer" : null}
                allClassesLabel={t("allClasses")}
                onClassSelect={handleClassChange}
                onSpecSelect={handleSpecSelect}
                onClear={clearClassAndSpec}
              />
            </div>
            {selectedClass ? <ClearFilterButton label={t("clearClass")} onClick={clearClassAndSpec} /> : null}
          </div>

          {/* Metric Selector */}
          <div className="flex min-w-[120px] gap-1.5">
            <div className="min-w-0 flex-1">
              <MetricSelector selectedMetric={selectedMetric} onChange={handleMetricChange} />
            </div>
            {selectedMetric !== "dps" ? <ClearFilterButton label={t("clearRole")} onClick={() => handleMetricChange("dps")} /> : null}
          </div>

          {showPartitionSelector && (
            <div className="flex-1 min-w-[160px]">
              <Selector
                items={partitionOptions}
                selectedItem={selectedPartition}
                onChange={handlePartitionChange}
                placeholder={t("placeholderAllPatches")}
                renderButton={(partition) => <span className="whitespace-nowrap">{partition?.label}</span>}
                renderOption={(partition) => <span>{partition.label}</span>}
              />
            </div>
          )}
        </div>
      </div>

      <Table
        columns={columns}
        data={data}
        loading={loading}
        pagination={pagination}
        onPageChange={handlePageChange}
        getRank={(row: CharacterRankingRow) => row.rank}
        expandedContent={
          !selectedBoss && bosses.length > 0 ? (row: CharacterRankingRow) => <MobileBossScores row={row} bosses={bosses} selectedSpec={selectedSpec} variant={variant} /> : undefined
        }
      />
    </div>
  );
}

"use client";

import { Combobox } from "@headlessui/react";
import { useMemo, useState, type ReactNode } from "react";

type FunAutocompleteProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSearchText?: (item: T) => string;
  renderOption?: (item: T) => ReactNode;
  placeholder: string;
  emptyLabel: string;
  disabled?: boolean;
  loading?: boolean;
  filterItems?: boolean;
  onSelect: (item: T) => void;
  onQueryChange?: (query: string) => void;
};

export default function FunAutocomplete<T>({
  items,
  getKey,
  getLabel,
  getSearchText = getLabel,
  renderOption,
  placeholder,
  emptyLabel,
  disabled,
  loading = false,
  filterItems = true,
  onSelect,
  onQueryChange,
}: FunAutocompleteProps<T>) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!filterItems) return items.slice(0, 30);
    const normalized = normalizeAutocompleteText(query);
    if (!normalized) return items.slice(0, 20);
    return items.filter((item) => normalizeAutocompleteText(getSearchText(item)).includes(normalized)).slice(0, 30);
  }, [filterItems, getSearchText, items, query]);

  return (
    <Combobox<T | null>
      value={null}
      onChange={(item) => {
        if (!item) return;
        onSelect(item);
        setQuery("");
        onQueryChange?.("");
      }}
      disabled={disabled}
      immediate
    >
      <div className="relative w-full">
        <Combobox.Input
          className={`min-h-11 w-full rounded-md border border-slate-600 bg-slate-950/75 py-2 pl-3 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/25 disabled:cursor-not-allowed disabled:opacity-50 ${loading ? "pr-10" : "pr-3"}`}
          displayValue={(item: T | null) => (item ? getLabel(item) : "")}
          onChange={(event) => {
            setQuery(event.target.value);
            onQueryChange?.(event.target.value);
          }}
          placeholder={placeholder}
          autoComplete="off"
          aria-busy={loading}
        />
        {loading ? <span className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-500 border-t-blue-300" aria-hidden="true" /> : null}
        <Combobox.Options
          anchor="bottom start"
          className="z-50 max-h-64 w-[--input-width] overflow-auto rounded-md border border-slate-600 bg-slate-900 py-1 shadow-2xl [--anchor-gap:4px] empty:invisible"
        >
          {filtered.length === 0 ? <div className="px-3 py-3 text-sm text-slate-400">{emptyLabel}</div> : null}
          {filtered.map((item) => (
            <Combobox.Option key={getKey(item)} value={item} className="cursor-pointer data-focus:bg-blue-600/35">
              <div className="px-3 py-2 text-sm text-white">{renderOption ? renderOption(item) : getLabel(item)}</div>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </div>
    </Combobox>
  );
}

function normalizeAutocompleteText(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[æǽ]/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/[øö]/g, "o")
    .replace(/[ðđ]/g, "d")
    .replace(/ł/g, "l")
    .replace(/þ/g, "th")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

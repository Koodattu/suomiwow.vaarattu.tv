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
  onSelect,
  onQueryChange,
}: FunAutocompleteProps<T>) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-US");
    if (!normalized) return items.slice(0, 20);
    return items.filter((item) => getSearchText(item).toLocaleLowerCase("en-US").includes(normalized)).slice(0, 30);
  }, [getSearchText, items, query]);

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
          className="min-h-11 w-full rounded-md border border-slate-600 bg-slate-950/75 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/25 disabled:cursor-not-allowed disabled:opacity-50"
          displayValue={(item: T | null) => (item ? getLabel(item) : "")}
          onChange={(event) => {
            setQuery(event.target.value);
            onQueryChange?.(event.target.value);
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
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

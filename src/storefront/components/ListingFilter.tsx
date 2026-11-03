"use client";

// Search box + category chips for the listings that don't go through Catalog:
// the group-buy page (the home of a "groupbuy" layout store) and the two-ways
// home's on-hand shelf. Matching rules live in lib/storefront/listing-filter.
// Reuses the storefront's .input-wrap so it wears each store's theme exactly
// like the classic catalog's search does.

import { useRef } from "react";
import { ALL_CATEGORY, type ListingCategory } from "@/lib/storefront/listing-filter";
import "./listing-filter.css";

export type ListingFilterProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /** Chips to offer — already narrowed by listingCategories (empty = no chip row). */
  categories: (ListingCategory & { count: number })[];
  category: string;
  onCategoryChange: (id: string) => void;
  /** Items left after filtering, and before it — drives the live summary. */
  shown: number;
  total: number;
  /** "Search group buy" / "Search on-hand" — the input's accessible name. */
  label: string;
  placeholder?: string;
};

export function ListingFilter({
  query,
  onQueryChange,
  categories,
  category,
  onCategoryChange,
  shown,
  total,
  label,
  placeholder = "Search products…",
}: ListingFilterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filtering = query.trim() !== "" || category !== ALL_CATEGORY;

  const clearQuery = () => {
    onQueryChange("");
    inputRef.current?.focus();
  };

  return (
    <div className="sf-lf" role="search" aria-label={label}>
      <label className="input-wrap sf-lf__search">
        <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span className="sf-lf__sr">{label}</span>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              onQueryChange("");
            }
            // Enter on a phone: drop the keyboard so the results are visible.
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        {query && (
          <button type="button" className="sf-lf__clear" aria-label="Clear search" onClick={clearQuery}>
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </label>

      {categories.length > 0 && (
        <div className="sf-lf__chips" role="group" aria-label="Filter by category">
          <button
            type="button"
            className="sf-lf__chip"
            aria-pressed={category === ALL_CATEGORY}
            onClick={() => onCategoryChange(ALL_CATEGORY)}
          >
            All <span className="sf-lf__chip-n">{total}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className="sf-lf__chip"
              aria-pressed={category === c.id}
              onClick={() => onCategoryChange(category === c.id ? ALL_CATEGORY : c.id)}
            >
              {c.label} <span className="sf-lf__chip-n">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Announced as the shopper types; only shown while a filter is on. */}
      <p className="sf-lf__summary" aria-live="polite">
        {filtering ? `Showing ${shown} of ${total}` : ""}
      </p>
    </div>
  );
}

/** "No matches" for a filtered listing, with a one-tap way back to everything. */
export function ListingFilterEmpty({ query, onReset }: { query: string; onReset: () => void }) {
  return (
    <div className="sf-lf__empty">
      <p className="sf-lf__empty-title font-display">
        {query.trim() ? `Nothing matches “${query.trim()}”` : "Nothing in this category"}
      </p>
      <p className="sf-lf__empty-copy">Check the spelling, or try the product’s short name.</p>
      <button type="button" className="sf-lf__reset" onClick={onReset}>
        Show all products
      </button>
    </div>
  );
}

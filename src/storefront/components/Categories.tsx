import type { Category } from "../types";

export function Categories({
  categories,
  active,
  onChange,
}: {
  categories: Category[];
  active: string;
  onChange: (id: string) => void;
}) {
  // A tenant who never configured categories has nothing to filter by, and the
  // bar is sticky: rendering it anyway lays an empty band across the catalog
  // that scrolls with the shopper. Nothing to pick = nothing to draw.
  if (categories.length === 0) return null;

  return (
    <section className="categories" aria-label="Product categories">
      <div className="container">
        <div className="categories__scroll" role="tablist">
          {categories.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={active === c.id}
              className={`chip ${active === c.id ? "is-active" : ""}`}
              onClick={() => onChange(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

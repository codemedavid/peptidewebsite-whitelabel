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

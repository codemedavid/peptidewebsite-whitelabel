import { sectionRegistry } from "./sections/registry";
import { pageSectionsSchema, type Section } from "./sections/types";

/**
 * Walks a Page.sections array and renders each typed block.
 * Unknown section types are skipped (forward-compatible with new editors).
 * Async sections (e.g. ProductGrid) are awaited by React automatically.
 */
export function SectionRenderer({ sections }: { sections: unknown }) {
  const parsed = pageSectionsSchema.safeParse(sections);
  const list: Section[] = parsed.success ? parsed.data : [];

  return (
    <>
      {list.map((section, i) => {
        const Component = sectionRegistry[section.type];
        if (!Component) return null;
        return <Component key={`${section.type}-${i}`} {...section.props} />;
      })}
    </>
  );
}

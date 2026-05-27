export type FAQProps = {
  title?: string;
  items?: { q: string; a: string }[];
};

export function FAQ({ title = "Frequently asked questions", items = [] }: FAQProps) {
  if (items.length === 0) return null;
  return (
    <section className="bg-muted/40">
      <div className="container py-16">
        <h2 className="font-heading text-3xl font-bold text-foreground">{title}</h2>
        <dl className="mt-8 space-y-6">
          {items.map((item, i) => (
            <div key={i} className="rounded-[var(--radius)] border border-border bg-card p-6">
              <dt className="font-medium text-card-foreground">{item.q}</dt>
              <dd className="mt-2 text-muted-foreground">{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

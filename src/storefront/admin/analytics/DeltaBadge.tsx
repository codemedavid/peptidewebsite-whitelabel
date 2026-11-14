// "▲ 12%" / "▼ 4.5%" / "—" — the one change badge every analytics surface uses.
// `value` is a percentage (12.3 = +12.3%); null = no baseline to compare with.

export function formatPct(value: number): string {
  const abs = Math.abs(value);
  return `${abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)}%`;
}

export function DeltaBadge({ value, title }: { value: number | null; title?: string }) {
  if (value === null) return <span className="ana-delta ana-delta--none" title={title ?? "No earlier sales to compare"}>—</span>;
  const kind = value > 0.05 ? "up" : value < -0.05 ? "down" : "flat";
  const arrow = kind === "up" ? "▲" : kind === "down" ? "▼" : "•";
  const words = kind === "flat" ? "no change" : `${kind} ${formatPct(value)}`;
  return (
    <span className={`ana-delta ana-delta--${kind}`} title={title} aria-label={words}>
      <span aria-hidden="true">{arrow}</span> {formatPct(value)}
    </span>
  );
}

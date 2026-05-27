export function BackLink({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button className="page__back" onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      {label || "Back"}
    </button>
  );
}

// Copy text to the clipboard from a click handler.
//
// The async Clipboard API only exists on secure origins (https, localhost) —
// on plain http (e.g. tenant.lvh.me in dev, or any http preview) it is
// undefined, so a copy that relies on it silently does nothing. The fallback
// selects a hidden textarea and runs execCommand("copy"), which works on any
// origin as long as it runs inside the user's click.

function copyWithTextarea(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  active?.focus?.();
  return ok;
}

/** Resolves true when the text reached the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied / document not focused — fall through.
    }
  }
  return copyWithTextarea(text);
}

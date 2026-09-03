// Copy-to-clipboard with the fallback the storefront actually needs.
//
// The people who most need a copy button are on the browsers that break it:
// `navigator.clipboard` is undefined outside a secure context and is denied
// outright by several in-app browsers (the Facebook and Instagram webviews
// among them) — which is exactly where a store owner is when they are pasting a
// product link into a chat. The legacy execCommand path still works there.
//
// Extracted from the identical routine in pages/OrderConfirmedPage.tsx so the
// share button cannot drift from the hand-off's already-hardened behaviour.
// (Those existing callers keep their local copies for now; this is the single
// home to consolidate them into.)

/**
 * Returns false when BOTH paths fail, so the caller can fall back to putting the
 * text on screen for the user to select by hand rather than silently doing
 * nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof document === "undefined" || !text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* denied or unavailable — try the legacy path before giving up */
  }
  try {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    // Off-screen but still selectable: display:none or visibility:hidden would
    // make the selection — and so the copy — a no-op.
    scratch.style.position = "fixed";
    scratch.style.top = "-9999px";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    scratch.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(scratch);
    return copied;
  } catch {
    return false;
  }
}

// The two install buttons on a store's /app page. Plain links (no client JS):
// the App Store listing, and the Android build when one is published.

import type { AndroidKind } from "@/lib/mobile/app-download";

const APPLE_GLYPH =
  "M16.37 12.6c-.02-2.32 1.9-3.44 1.98-3.5-1.08-1.58-2.76-1.8-3.36-1.82-1.43-.15-2.79.84-3.51.84-.73 0-1.84-.82-3.03-.8-1.56.02-3 .91-3.8 2.3-1.62 2.81-.41 6.97 1.16 9.25.78 1.12 1.7 2.37 2.9 2.33 1.17-.05 1.6-.75 3.01-.75 1.4 0 1.8.75 3.03.73 1.25-.02 2.04-1.14 2.8-2.27.89-1.3 1.25-2.56 1.27-2.63-.03-.01-2.43-.93-2.45-3.68zM14.06 5.8c.64-.78 1.07-1.85.95-2.93-.92.04-2.04.62-2.7 1.39-.59.68-1.11 1.78-.97 2.83 1.03.08 2.07-.52 2.72-1.29z";

const ANDROID_GLYPH =
  "M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.7 10.7 0 0 0 1 18h22a10.7 10.7 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z";

interface IosButtonProps {
  href: string;
}

export function AppStoreButton({ href }: IosButtonProps) {
  return (
    <a href={href} rel="noopener" className="ga-store-btn">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d={APPLE_GLYPH} />
      </svg>
      <span>
        <small>Download on the</small>
        <strong>App Store</strong>
      </span>
    </a>
  );
}

interface AndroidButtonProps {
  href: string | null;
  kind: AndroidKind | null;
}

export function AndroidButton({ href, kind }: AndroidButtonProps) {
  if (!href) {
    return (
      <span className="ga-store-btn ga-store-btn--soon">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d={ANDROID_GLYPH} />
        </svg>
        <span>
          <small>Android</small>
          <strong>Coming soon</strong>
        </span>
      </span>
    );
  }
  return (
    <a href={href} rel="noopener" className="ga-store-btn">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d={ANDROID_GLYPH} />
      </svg>
      <span>
        <small>{kind === "play" ? "Get it on" : "Download for"}</small>
        <strong>{kind === "play" ? "Google Play" : "Android"}</strong>
      </span>
    </a>
  );
}

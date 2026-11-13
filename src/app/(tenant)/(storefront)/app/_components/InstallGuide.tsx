// "Set up in a minute" — numbered install steps for iPhone and Android, with
// the visitor's own platform first and outlined. The Android card reflects
// what actually exists: a Play listing, a direct APK, or nothing yet.

import type { ReactNode } from "react";
import Link from "next/link";

import { APP_NAME, IOS_MIN_VERSION, type AppDownloads, type VisitorDevice } from "@/lib/mobile/app-download";

type Props = {
  storeName: string;
  downloads: AppDownloads;
  device: VisitorDevice;
};

export function InstallGuide({ storeName, downloads, device }: Props) {
  const openStep = (
    <li>
      <span>
        Open this page again on the same phone and tap <b>Open {storeName} in the app</b> and it goes straight to our
        store. Then create your account or sign in.
      </span>
    </li>
  );
  const ios = (
    <PlatformCard
      key="ios"
      title="iPhone & iPad"
      caption={`From the App Store · iOS ${IOS_MIN_VERSION} or later`}
      isFirst={device === "ios"}
    >
      <ol className="ga-steps">
        <li>
          <span>
            Tap <b>Download on the App Store</b>, then <b>Get</b>.
          </span>
        </li>
        {openStep}
      </ol>
    </PlatformCard>
  );
  const android = (
    <PlatformCard key="android" title="Android" caption={androidCaption(downloads)} isFirst={device === "android"}>
      {downloads.androidUrl ? (
        <ol className="ga-steps">
          {downloads.androidKind === "play" ? (
            <li>
              <span>
                Tap <b>Get it on Google Play</b>, then <b>Install</b>.
              </span>
            </li>
          ) : (
            <>
              <li>
                <span>
                  Tap <b>Download for Android</b>. Wi-Fi helps, it&apos;s a big file.
                </span>
              </li>
              <li>
                <span>
                  Open the downloaded file. If your phone asks, allow your browser to <b>install unknown apps</b>.
                </span>
              </li>
            </>
          )}
          {openStep}
        </ol>
      ) : (
        <p className="text-muted-foreground">
          {APP_NAME} for Android is in its final testing. Until it&apos;s out, everything works on the website:{" "}
          <Link href="/" className="ga-link-btn">
            shop {storeName} now
          </Link>
          .
        </p>
      )}
    </PlatformCard>
  );
  const cards = device === "android" ? [android, ios] : [ios, android];

  return (
    <section aria-labelledby="ga-install-heading" className="flex flex-col gap-8">
      <div className="max-w-xl">
        <h2 id="ga-install-heading" className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          Set up in a minute
        </h2>
        <p className="mt-2 text-muted-foreground">Free to download. Your account belongs to {storeName}.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">{cards}</div>
    </section>
  );
}

function androidCaption(downloads: AppDownloads): string {
  if (downloads.androidKind === "play") return "From Google Play";
  if (downloads.androidKind === "apk") return "Direct download";
  return "Coming soon";
}

type CardProps = { title: string; caption: string; isFirst: boolean; children: ReactNode };

function PlatformCard({ title, caption, isFirst, children }: CardProps) {
  return (
    <article className={isFirst ? "ga-install ga-install--first" : "ga-install"}>
      <h3 className="font-heading text-xl font-semibold">{title}</h3>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">{caption}</p>
      {children}
    </article>
  );
}

import type { Metadata } from "next";
import { APP_NAME, resolveAndroidDownload } from "@/marketing/app-download";
import appIcon from "./pepworld-icon.png";
import "./download.css";

// Host-dependent (the layout guards on x-tenant-host), so never statically cache.
export const dynamic = "force-dynamic";

const DESCRIPTION = `Download the ${APP_NAME} app for Android — shop your favorite independent stores, track orders, and chat with the community.`;

export const metadata: Metadata = {
  title: `Download ${APP_NAME}`,
  description: DESCRIPTION,
  openGraph: { title: `Download ${APP_NAME} · Pepweb`, description: DESCRIPTION },
  twitter: { title: `Download ${APP_NAME} · Pepweb`, description: DESCRIPTION },
};

const INSTALL_STEPS = [
  {
    title: "Download the APK",
    body: "Tap the download button on your Android phone. If Chrome says the file might be harmful, tap “Download anyway” — it’s our official build.",
  },
  {
    title: "Allow the install",
    body: "Open the file from your notifications or Downloads. If asked, turn on “Allow from this source” for your browser, then go back.",
  },
  {
    title: "Install & sign in",
    body: `Tap Install, open ${APP_NAME}, and sign in with your store account — or browse as a guest.`,
  },
] as const;

export default function DownloadPage() {
  const { apkUrl, apkVersion, apkSizeLabel, playStoreUrl } = resolveAndroidDownload();
  const apkMeta = [`Version ${apkVersion}`, apkSizeLabel, "Android 7+"].filter(Boolean).join(" · ");

  return (
    <>
      <section className="mk-section mk-section--tight dl-hero" aria-labelledby="dl-heading">
        <div className="mk-container dl-hero-grid">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element -- static 256px brand icon */}
            <img src={appIcon.src} width={64} height={64} alt="" className="dl-mobile-icon" />
            <p className="mk-eyebrow">The {APP_NAME} app</p>
            <h1 id="dl-heading" className="mk-h1">
              Your stores, orders &amp; community — <em>in your pocket</em>
            </h1>
            <p className="mk-lead">
              Shop your favorite independent stores, track every order from checkout to delivery, and chat with sellers
              and the community. Store owners can run their whole shop from the same app.
            </p>

            <div className="dl-actions">
              {playStoreUrl && (
                <a className="mk-btn mk-btn-primary mk-btn-lg" href={playStoreUrl} rel="noopener">
                  Get it on Google Play
                </a>
              )}
              {apkUrl ? (
                <a
                  className={`mk-btn mk-btn-lg ${playStoreUrl ? "mk-btn-ghost" : "mk-btn-primary"}`}
                  href="/download/android"
                >
                  <DownloadIcon />
                  Download for Android
                </a>
              ) : (
                <span className="mk-btn mk-btn-lg mk-btn-soft" aria-disabled="true">
                  Android download coming shortly
                </span>
              )}
            </div>
            <p className="dl-meta">
              {apkMeta}
              {!playStoreUrl && <> · Google Play listing in review</>}
            </p>
          </div>

          <figure className="dl-device" aria-hidden="true">
            <div className="dl-device-screen">
              {/* eslint-disable-next-line @next/next/no-img-element -- static 256px brand icon */}
              <img src={appIcon.src} width={96} height={96} alt="" className="dl-device-icon" />
              <span className="dl-device-name">{APP_NAME}</span>
              <span className="dl-device-tag">Shop · Track · Chat</span>
            </div>
          </figure>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="dl-steps-heading">
        <div className="mk-container">
          <h2 id="dl-steps-heading" className="mk-h2">
            Installing on Android
          </h2>
          <p className="mk-lead dl-steps-lead">
            While the Google Play listing is in review, install directly — it takes about a minute.
          </p>
          <ol className="dl-steps">
            {INSTALL_STEPS.map((step, i) => (
              <li key={step.title} className="dl-step">
                <span className="dl-step-n">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mk-h3">{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mk-section mk-section--tight" aria-label="Good to know">
        <div className="mk-container dl-notes">
          <div>
            <h3 className="mk-h3">Moving to Google Play later</h3>
            <p>
              When {APP_NAME} goes live on Google Play, uninstall this version first, then install from the Play
              Store to get automatic updates. Your account, orders, and chats are saved online — just sign back in.
            </p>
          </div>
          <div>
            <h3 className="mk-h3">On iPhone?</h3>
            <p>
              {APP_NAME} for iPhone is coming to the App Store soon. Until then, every store works in Safari — no
              download needed.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="dl-btn-icon">
      <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

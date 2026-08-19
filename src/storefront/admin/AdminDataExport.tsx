"use client";

// Store-admin "Export My Data" panel (OWNER-ONLY) — the owner's exit door.
//
// It answers a question every owner is entitled to ask before committing to a
// platform: if I ever stop using Pepweb, do I get my products, my customers and
// my order history back? This screen is the yes. One click builds the export
// server-side (actions/storefront-export) and saves it as four spreadsheets plus
// one JSON dump.
//
// The panel deliberately does NO data shaping of its own: the server action
// returns finished files (filename + mime + content) from the shared pure core
// in lib/storefront/data-export, and this component only turns them into
// downloads. That is what keeps the exported money identical to the money on
// the Orders screen — there is one implementation, not two.

import { useState } from "react";
import { useStore } from "../store";
import { AdminIcon } from "./shared";
import { exportStoreDataAction } from "@/actions/storefront-export";
import type { DataExportBundle, ExportFile } from "@/lib/storefront/data-export";

/** Hand one prepared file to the browser as a download. */
function saveFile(file: ExportFile) {
  const blob = new Blob([file.content], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** What each file in the bundle is, in the owner's words. */
const FILE_BLURB: { match: string; label: string; hint: string }[] = [
  { match: "-products-", label: "Products", hint: "Your full catalog — one row per size/option, with prices and stock." },
  { match: "-orders-", label: "Orders", hint: "Every order with its customer, address, fees and total." },
  { match: "-order-items-", label: "Order items", hint: "One row per line item — what was bought, how many, at what price." },
  { match: "-customers-", label: "Customers", hint: "Your customer list, merged across repeat orders, with lifetime spend." },
  { match: "-store-data-", label: "Everything (JSON)", hint: "The same data in developer format, for importing elsewhere." },
];

function blurbFor(filename: string) {
  return FILE_BLURB.find((b) => filename.includes(b.match));
}

export function AdminDataExport({ onBack }: { onBack: () => void }) {
  const { toast } = useStore();
  const [bundle, setBundle] = useState<DataExportBundle | null>(null);
  const [busy, setBusy] = useState(false);

  const prepare = async (): Promise<DataExportBundle | null> => {
    const res = await exportStoreDataAction();
    if ("error" in res) {
      toast(res.error);
      return null;
    }
    setBundle(res.bundle);
    return res.bundle;
  };

  const downloadAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ready = await prepare();
      if (!ready) return;
      // Sequential clicks: browsers throttle a burst of synthetic downloads, so
      // a small stagger is what actually gets all five files onto disk.
      for (const [i, file] of ready.files.entries()) {
        setTimeout(() => saveFile(file), i * 350);
      }
      toast("Your data is downloading…");
    } catch {
      toast("Couldn't build the export — please sign in again and retry.");
    } finally {
      setBusy(false);
    }
  };

  // Always rebuilds rather than reusing the last bundle — an owner who exports,
  // edits an order, then grabs one more file must not get yesterday's numbers.
  const downloadOne = async (match: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const ready = await prepare();
      const file = ready?.files.find((f) => f.filename.includes(match));
      if (file) saveFile(file);
    } catch {
      toast("Couldn't build the export — please sign in again and retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <AdminIcon name="download" />
          Export My Data
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={downloadAll} disabled={busy}>
          <AdminIcon name="download" />
          {busy ? "Preparing…" : "Download everything"}
        </button>
      </header>

      <div className="admin-form__body">
        <div className="admin-form__card">
          <h2 className="admin-form__section">Your data is yours</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 16 }}>
            Download your products, customers and complete order history at any time — no
            request, no waiting. The spreadsheets open in Excel, Numbers or Google Sheets,
            and the JSON file is what a developer would use to import your store somewhere
            else. Orders you have deleted are included too, flagged <strong>Deleted</strong>,
            so nothing is left behind.
          </div>

          <div className="admin-field">
            <button type="button" className="admin-btn" onClick={downloadAll} disabled={busy}>
              {busy ? "Preparing…" : "Download everything"}
            </button>
            <div className="admin-field__hint">
              Saves all five files. Your browser may ask permission to download multiple files.
            </div>
          </div>

          {bundle && (
            <div className="admin-field__hint" style={{ marginTop: 4 }}>
              Last export: {bundle.counts.products} products · {bundle.counts.orders} orders ·{" "}
              {bundle.counts.orderItems} order lines · {bundle.counts.customers} customers.
            </div>
          )}
        </div>

        <div className="admin-form__card">
          <h2 className="admin-form__section">Or pick one file</h2>
          {FILE_BLURB.map((b) => (
            <div className="admin-field" key={b.match}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  disabled={busy}
                  onClick={() => downloadOne(b.match)}
                >
                  {b.label}
                </button>
                <span className="admin-field__hint" style={{ margin: 0 }}>{b.hint}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="admin-form__card">
          <h2 className="admin-form__section">What&rsquo;s inside</h2>
          <div className="admin-field__hint">
            <strong>Products</strong> — id, name, each size/option with its own price and stock,
            category, description and image link.
            <br />
            <strong>Orders</strong> — order number, date, status, payment, the customer and full
            shipping address, subtotal, discount, shipping fee, service fee and total.
            <br />
            <strong>Order items</strong> — one row per product line, so you can rebuild sales by
            product anywhere.
            <br />
            <strong>Customers</strong> — one row per person (repeat orders merged), with contact
            details, latest address, order count and lifetime spend.
            <br />
            <strong>Everything (JSON)</strong> — all of the above in one structured file.
          </div>
        </div>
      </div>
    </div>
  );
}

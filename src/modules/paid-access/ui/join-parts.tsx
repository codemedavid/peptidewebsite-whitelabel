"use client";

// Pieces of the member's join page: where to pay, the proof form, the
// application form, and the "proof sent" receipt. Presentational + their own
// form state; every submit goes through the server action handed in.

import { useEffect, useRef, useState } from "react";

import type { GroupBuyJoinQuestion, GroupBuyJoinResult, GroupBuyJoinState, ShopPaymentMethod } from "@/lib/mobile/shop-contract";
import { ProofLightbox } from "@/storefront/admin/gb-proof-lightbox";
import { getPaidAccessReceiptUrlAction, submitPaidAccessFormAction, submitPaidAccessProofAction } from "../actions";
import { cachedProofUrl } from "./proof-url-cache";

type Run = (fn: () => Promise<GroupBuyJoinResult>) => Promise<void>;
const RECEIPT_ACCEPT = "image/*,.jpg,.jpeg,.png,.webp,.heic,.heif";

export function PaymentAccounts({ methods, amount }: { methods: ShopPaymentMethod[]; amount: string }) {
  const [copied, setCopied] = useState("");
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? "" : c)), 1600);
    } catch {
      /* clipboard blocked — the number is still on screen to type */
    }
  };
  return (
    <div className="bnnjoin__card">
      <h2 className="bnnjoin__h2">Send exactly {amount} to</h2>
      {methods.length === 0 ? (
        <p className="bnnjoin__muted">The store hasn’t listed a payment account yet — message them for where to pay.</p>
      ) : (
        <ul className="bnnjoin__methods">
          {methods.map((m) => (
            <li key={m.id} className="bnnjoin__method">
              <div>
                <div className="bnnjoin__method-name">{m.name}</div>
                {m.account && <div className="bnnjoin__muted">{m.account}</div>}
                {m.number && (
                  <div className="bnnjoin__number">
                    <span>{m.number}</span>
                    <button type="button" className="bnnjoin__copy" onClick={() => void copy(m.id, m.number)} aria-label={`Copy ${m.name} number`}>
                      {copied === m.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
              {m.qrImage && <img className="bnnjoin__qr" src={m.qrImage} alt={`${m.name} QR code`} width={96} height={96} loading="lazy" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ProofFormProps = {
  groupBuyId: string;
  methods: ShopPaymentMethod[];
  isBusy: boolean;
  onRun: Run;
  /** Override the send (the email-only join establishes who they are first). */
  submit?: (form: FormData) => Promise<GroupBuyJoinResult>;
  /** Extra condition for the send button (e.g. a valid email typed above). */
  ready?: boolean;
  cta?: string;
};

export function ProofForm({ groupBuyId, methods, isBusy, onRun, submit = submitPaidAccessProofAction, ready = true, cta = "Send proof" }: ProofFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState(methods[0]?.name ?? "");
  const [paidAt, setPaidAt] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : "");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = new FormData();
    form.set("groupBuyId", groupBuyId);
    if (file) form.set("file", file);
    form.set("reference", reference);
    form.set("method", method);
    if (paidAt) form.set("paidAt", new Date(paidAt).toISOString());
    void onRun(() => submit(form));
  };

  return (
    <form className="bnnjoin__card bnnjoin__form" onSubmit={handleSubmit}>
      <h2 className="bnnjoin__h2">Send your proof of payment</h2>
      <button type="button" className={`bnnjoin__drop${preview ? " has-file" : ""}`} onClick={() => input.current?.click()}>
        {preview ? <img src={preview} alt="Your proof of payment" /> : <span>Tap to add a screenshot of your payment</span>}
      </button>
      <input ref={input} type="file" accept={RECEIPT_ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      <label className="bnnjoin__field">
        <span>Reference number</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 1023 4567 8901" autoComplete="off" maxLength={64} required />
      </label>
      {methods.length > 0 && (
        <label className="bnnjoin__field">
          <span>Paid with</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="bnnjoin__field">
        <span>When you paid <em>(optional)</em></span>
        <input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary bnnjoin__cta" disabled={isBusy || !ready || !file || reference.trim().length < 4}>
        {isBusy ? "Sending…" : cta}
      </button>
    </form>
  );
}

type ApplicationFormProps = {
  questions: GroupBuyJoinQuestion[];
  groupBuyId: string;
  isBusy: boolean;
  onRun: Run;
  submit?: (answers: Record<string, string>) => Promise<GroupBuyJoinResult>;
  ready?: boolean;
};

export function ApplicationForm({ questions, groupBuyId, isBusy, onRun, submit, ready = true }: ApplicationFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const set = (id: string, value: string) => setAnswers((a) => ({ ...a, [id]: value }));
  const missing = questions.some((q) => q.required && !(answers[q.id] ?? "").trim());
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onRun(() => (submit ? submit(answers) : submitPaidAccessFormAction(groupBuyId, answers)));
  };
  return (
    <form className="bnnjoin__card bnnjoin__form" onSubmit={handleSubmit}>
      <h2 className="bnnjoin__h2">Your application</h2>
      {questions.map((q) => (
        <label key={q.id} className="bnnjoin__field">
          <span>
            {q.label}
            {!q.required && <em> (optional)</em>}
          </span>
          {q.kind === "long" ? (
            <textarea rows={4} maxLength={2000} value={answers[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)} required={q.required} />
          ) : q.kind === "choice" ? (
            <select value={answers[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)} required={q.required}>
              <option value="">Choose…</option>
              {q.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input maxLength={200} value={answers[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)} required={q.required} />
          )}
        </label>
      ))}
      <button type="submit" className="btn btn-primary bnnjoin__cta" disabled={isBusy || !ready || missing}>
        {isBusy ? "Sending…" : "Send application"}
      </button>
    </form>
  );
}

type SentProofProps = {
  groupBuyId: string;
  proof: NonNullable<GroupBuyJoinState["proof"]>;
  amount: string;
  /** False for an email-only join: anyone can type an email, so the proof's
   *  details and screenshot stay with the store (and a signed-in account). */
  showDetails?: boolean;
};

export function SentProof({ groupBuyId, proof, amount, showDetails = true }: SentProofProps) {
  const [msg, setMsg] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const view = async () => {
    setMsg("");
    const res = await cachedProofUrl(`member:${groupBuyId}`, () => getPaidAccessReceiptUrlAction(groupBuyId)).catch(() => null);
    if (res && res.ok) setProofUrl(res.url);
    else setMsg(res && !res.ok ? res.message : "Couldn't open your proof.");
  };
  return (
    <div className="bnnjoin__card">
      <dl className="bnnjoin__facts">
        <div><dt>Amount</dt><dd>{amount}</dd></div>
        {showDetails && <div><dt>Reference</dt><dd>{proof.reference}</dd></div>}
        {showDetails && proof.method && <div><dt>Paid with</dt><dd>{proof.method}</dd></div>}
        {proof.submittedAt && <div><dt>Sent</dt><dd>{new Date(proof.submittedAt).toLocaleString()}</dd></div>}
      </dl>
      {showDetails && proof.hasReceipt && (
        <button type="button" className="bnnjoin__link" onClick={() => void view()}>View my proof</button>
      )}
      {msg && <p className="bnnjoin__muted" role="alert">{msg}</p>}
      {proofUrl && <ProofLightbox url={proofUrl} label="Your payment" onClose={() => setProofUrl(null)} />}
    </div>
  );
}

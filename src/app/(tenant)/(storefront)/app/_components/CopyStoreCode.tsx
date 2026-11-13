"use client";

// Copies the store code the app asks for. Uses the shared clipboard helper so
// it still works inside the Facebook / Instagram in-app browsers, where most
// of these links get opened.

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyText } from "@/lib/storefront/clipboard";

const RESET_MS = 2000;

type Props = { code: string };

type CopyState = "idle" | "copied" | "failed";

const LABEL: Record<CopyState, string> = { idle: "Copy code", copied: "Copied", failed: "Select it above to copy" };

export function CopyStoreCode({ code }: Props) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const id = window.setTimeout(() => setState("idle"), RESET_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  async function handleCopy() {
    setState((await copyText(code)) ? "copied" : "failed");
  }

  return (
    <button type="button" className="ga-copy" onClick={() => void handleCopy()}>
      {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      <span aria-live="polite">{LABEL[state]}</span>
    </button>
  );
}

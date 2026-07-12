import Link from "next/link";
import { FINAL_CTA } from "@/marketing/config";

export function FinalCta() {
  return (
    <section className="mk-cta-band">
      <h2 className="mk-h2">{FINAL_CTA.title}</h2>
      <p>{FINAL_CTA.body}</p>
      <Link href="/get-started" className="mk-btn mk-btn-primary">
        {FINAL_CTA.cta} →
      </Link>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function FinalCta() {
  return (
    <section className="mk-section mk-section--tight">
      <div className="mk-container">
        <div className="mk-cta-band">
          <h2 className="mk-h2">Ready To Launch Your Website?</h2>
          <p>
            Tell us about your business and we&apos;ll build a branded, order-ready store for you.
            It only takes a few minutes to get started.
          </p>
          <Link href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">
            Start Your Website <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

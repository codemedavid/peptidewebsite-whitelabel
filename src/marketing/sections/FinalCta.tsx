import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function FinalCta() {
  return (
    <section className="mk-section mk-section--tight">
      <div className="mk-container">
        <div className="mk-cta-band">
          <h2 className="mk-h2">
            Mas kaunting oras sa chat.
            <br />
            Mas maraming oras sa paglago.
          </h2>
          <p>
            Sagutin ang ilang simpleng tanong tungkol sa business mo, at kami na ang bahala sa
            setup. Sa loob ng ilang araw, may system ka nang sumasagot para sa&apos;yo.
          </p>
          <Link href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">
            Get Started <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

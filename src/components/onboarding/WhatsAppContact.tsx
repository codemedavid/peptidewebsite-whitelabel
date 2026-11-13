import { MessageCircle } from "lucide-react";
import { SITE, contactWhatsappUrl } from "@/marketing/config";

type Props = {
  /** Lead-in before the link, e.g. "Questions?" */
  lead?: string;
  /** Prefilled chat text (e.g. a sign-up reference). */
  message?: string;
  className?: string;
};

/** "Questions? Message us on WhatsApp" — the platform's own contact line. */
export function WhatsAppContact({ lead = "Questions?", message, className = "mk-link" }: Props) {
  return (
    <a
      href={contactWhatsappUrl(message)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <MessageCircle size={16} aria-hidden="true" />
      {lead} Message us on WhatsApp ({SITE.contactWhatsappDisplay})
    </a>
  );
}

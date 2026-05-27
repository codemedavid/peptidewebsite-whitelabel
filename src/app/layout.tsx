import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Peptide White-Label SaaS",
  description: "Multi-tenant platform for peptide storefronts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

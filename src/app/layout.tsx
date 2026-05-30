import type { Metadata, Viewport } from "next";
import "./globals.css";
import TopLoadingBar from "./_components/TopLoadingBar";

export const metadata: Metadata = {
  title: "Peptide White-Label SaaS",
  description: "Multi-tenant platform for peptide storefronts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopLoadingBar />
        {children}
      </body>
    </html>
  );
}

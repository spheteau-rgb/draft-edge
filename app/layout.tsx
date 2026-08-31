import type { Metadata } from "next";
import "./globals.css";
import ModeNav from "@/components/ModeNav";

export const metadata: Metadata = {
  title: "Draft Edge",
  description: "Real-time draft assistant for Family Affair fantasy football.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ModeNav />
        {children}
      </body>
    </html>
  );
}

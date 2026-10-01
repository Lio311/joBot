import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Heebo } from "next/font/google";
import { NoZoom } from "@/components/no-zoom";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Geist has no Hebrew glyphs; Heebo carries the Hebrew UI.
const heebo = Heebo({ variable: "--font-heebo", subsets: ["hebrew", "latin"] });

export const metadata: Metadata = {
  title: "joBot",
  description: "משרות הייטק שמתאימות לקורות החיים שלי, נאספות כמה פעמים ביום.",
  robots: { index: false, follow: false },
  applicationName: "joBot",
  // Home-screen app on iPhone: full screen, light status bar text over the page colour.
  appleWebApp: { capable: true, title: "joBot", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0e" },
  ],
  viewportFit: "cover",
  // App-like on phones: no pinch or double-tap zoom (desktop browser zoom is unaffected).
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${geistSans.variable} ${geistMono.variable} ${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <NoZoom />
        {children}
      </body>
    </html>
  );
}

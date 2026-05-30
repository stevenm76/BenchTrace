import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";

import { Sidebar } from "@/components/layout/Sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readTheme, readTier } from "@/lib/tier/cookie";
import { TierProvider } from "@/lib/tier/TierProvider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BenchTrace",
  description:
    "Local-first LLM performance trace system. Import, normalize, compare, and share benchmark results from vLLM, SGLang, llama.cpp, Ollama, and OpenAI-compatible servers.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tier = await readTier();
  const theme = await readTheme();
  // For "system", we let the client decide at hydration. SSR defaults to
  // light (no .dark class). The ThemeToggle effect re-applies on mount.
  const htmlClass =
    theme === "dark"
      ? "dark"
      : ""; // light + system → no .dark on SSR; ThemeToggle handles system at runtime.

  return (
    <html
      lang="en"
      data-tier={tier}
      className={`${htmlClass} ${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <TierProvider initial={tier}>
          <TooltipProvider delay={150}>
            <div className="flex min-h-screen">
              <Sidebar initialTheme={theme} />
              <main className="flex-1 min-w-0">{children}</main>
            </div>
          </TooltipProvider>
        </TierProvider>
        <Toaster richColors />
      </body>
    </html>
  );
}

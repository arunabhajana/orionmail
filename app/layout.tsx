import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TitlebarWrapper from "@/components/TitlebarWrapper"; // Wrapper handles client-side only import
import { AuthProvider } from "@/components/AuthContext";
import { SyncProvider } from "@/components/SyncContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AccentColorProvider } from "@/components/AccentColorProvider";
import { DownloadProvider } from "@/components/DownloadContext";
import { Toaster } from "sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OrionMail",
  description: "Glassmorphic Email Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Adding comment to force recompile
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AccentColorProvider>
            <AuthProvider>
              <SyncProvider>
                <DownloadProvider>
                  <div className="app-window">
                    <TitlebarWrapper />
                    <div className="pt-[30px] h-full w-full overflow-hidden">
                      {children}
                    </div>
                    <Toaster theme="system" richColors position="top-center" />
                  </div>
                </DownloadProvider>
              </SyncProvider>
            </AuthProvider>
          </AccentColorProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

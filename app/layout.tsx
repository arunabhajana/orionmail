import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TitlebarWrapper from "@/components/TitlebarWrapper"; // Wrapper handles client-side only import
import { PersistentInbox } from "@/components/PersistentInbox";
import { MailtoNavigation } from "@/components/MailtoNavigation";
import { AuthProvider } from "@/components/AuthContext";
import {MailboxViewProvider} from "@/components/MailboxViewContext";
import { SyncProvider } from "@/components/SyncContext";
import {PublicPageBoundary,DesktopRouteContent} from "@/components/PublicPageBoundary";
import {UpdateProvider} from "@/components/UpdateProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AccentColorProvider } from "@/components/AccentColorProvider";
import { DownloadProvider } from "@/components/DownloadContext";
import { AppPreferencesProvider } from "@/components/AppPreferencesContext";
import { BackgroundTasksProvider } from "@/components/BackgroundTasksContext";
import { Toaster } from "sonner";
import { GlobalLoader } from "@/components/GlobalLoader";
import { AppLockGate } from "@/components/AppLockGate";
import { AppContextMenus } from "@/components/ui/AppContextMenus";
import {CommandPaletteProvider} from '@/components/CommandPalette';

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
            <PublicPageBoundary desktop={<AuthProvider>
              <BackgroundTasksProvider>
                <AppPreferencesProvider>
                  <MailboxViewProvider><SyncProvider>
                    <DownloadProvider>
                      <AppLockGate>
                        <UpdateProvider><AppContextMenus><CommandPaletteProvider>
                        <div className="app-window">
                          <MailtoNavigation />
                          <GlobalLoader />
                          <TitlebarWrapper />
                          <div className="pt-[30px] h-full w-full overflow-hidden">
                            <PersistentInbox />
                            <DesktopRouteContent>{children}</DesktopRouteContent>
                          </div>
                          <Toaster theme="system" richColors position="top-center" expand visibleToasts={3} gap={10} offset={48} closeButton duration={4500} />
                        </div>
                        </CommandPaletteProvider></AppContextMenus></UpdateProvider>
                      </AppLockGate>
                    </DownloadProvider>
                  </SyncProvider></MailboxViewProvider>
                </AppPreferencesProvider>
              </BackgroundTasksProvider>
            </AuthProvider>}>{children}</PublicPageBoundary>
          </AccentColorProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

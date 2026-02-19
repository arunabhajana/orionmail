import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TitlebarWrapper from "@/components/TitlebarWrapper"; // Wrapper handles client-side only import

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OrbitMail",
  description: "Glassmorphic Email Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Adding comment to force recompile
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        className={`${inter.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <div className="app-window">
          <TitlebarWrapper />
          <div className="pt-[30px] h-full w-full">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}

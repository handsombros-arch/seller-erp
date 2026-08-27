import type { Metadata } from "next";
import "./globals.css";
import { KoreanIME } from "@/components/KoreanIME";
import { ThemeProvider } from "@/components/layout/theme-provider";

export const metadata: Metadata = {
  title: "LV ERP",
  description: "셀러용 ERP 관리 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <KoreanIME />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

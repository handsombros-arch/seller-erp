import type { Metadata } from "next";
import { Nanum_Gothic } from "next/font/google";
import "./globals.css";

// 앱 전체 글꼴: 나눔고딕 (한글·숫자 모두). 로드 전에는 시스템 고딕으로 표시
const nanum = Nanum_Gothic({ weight: ["400", "700", "800"], subsets: ["latin"], display: "swap", variable: "--font-nanum" });
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
    <html lang="ko" suppressHydrationWarning className={nanum.variable}>
      <body
        className={`${nanum.className} antialiased`}
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

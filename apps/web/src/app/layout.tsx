import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paper Hunter",
  description: "Research-integrity evidence discovery workbench"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

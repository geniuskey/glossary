import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "용어집" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}

import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Naval AI | Scholarly Workspace",
  description: "Fan-made assistant referencing Naval's public writing; not Naval."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[var(--bg-midnight)] text-[var(--text-silver)] ui-font antialiased overflow-hidden">
        {children}
      </body>
    </html>
  );
}


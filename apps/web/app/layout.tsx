import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Epic Aid",
  description: "Spoiler-free reminders of who's who in long book series.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

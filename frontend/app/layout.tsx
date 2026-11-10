import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis Clinical Command Center",
  description: "Emergency care coordination and clinical safety workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

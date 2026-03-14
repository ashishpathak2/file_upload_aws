import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "S3 Multipart Upload",
  description: "Production-grade multipart file upload with resume support",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

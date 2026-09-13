import type { Metadata } from "next";
import "@excalidraw/excalidraw/index.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ideate — a space to understand",
  description:
    "Think through algorithms with a whiteboard, Python, your notes, and an AI study partner.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

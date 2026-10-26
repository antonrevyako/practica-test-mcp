import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Practica · local practice",
  description: "Local practice with PracticaTest and MCP.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

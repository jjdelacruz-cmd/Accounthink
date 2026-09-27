import type { Metadata, Viewport } from "next";
import { PwaSetup } from "@/components/PwaSetup";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accounthink",
  description: "Quizzes and exams for OLFU College of Business and Accountancy classes",
  applicationName: "Accounthink",
  appleWebApp: { capable: true, title: "Accounthink", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#047857",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <PwaSetup />
      </body>
    </html>
  );
}

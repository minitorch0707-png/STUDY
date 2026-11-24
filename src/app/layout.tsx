import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { ToastProvider } from "@/components/overlay";
import { UpgradeDialog } from "@/components/pro";


export const metadata: Metadata = {
  icons: { icon: "/brand/mark.svg", apple: "/brand/mark.png" },
  title: { default: "LectureLab", template: "%s · LectureLab" },
  description: "Turn your lectures into lessons, practice exams and flashcards — with a private, local AI tutor.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5ef" },
    { media: "(prefers-color-scheme: dark)", color: "#131c33" },
  ],
};

// Applies the saved theme before first paint (prevents a white flash in dark mode).
const themeScript = `try{var t=localStorage.getItem('ll-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">
        <ToastProvider>
          <AppShell>{children}</AppShell>
          <UpgradeDialog />
        </ToastProvider>
      </body>
    </html>
  );
}

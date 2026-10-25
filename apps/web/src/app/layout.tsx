import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { AppWorkspace } from "@/components/app-workspace";
import { AuthGate } from "@/components/auth-gate";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/zuno/tooltip";

const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const themeScript = `try{var theme=localStorage.getItem("billing-theme");document.documentElement.classList.remove("light","dark");document.documentElement.classList.add(theme==="dark"?"dark":"light")}catch{}`;

export const metadata: Metadata = {
  title: {
    default: "Hemia Billing",
    template: "%s | Hemia Billing",
  },
  description: "Consola interna para administrar Billing Core de Hemia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${sans.variable} ${geistMono.variable} light h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full">
        <TooltipProvider>
          <AuthGate>
            <SidebarProvider
              style={{
                "--sidebar-width": "var(--layout-sidebar-width)",
                "--sidebar-width-icon": "var(--layout-sidebar-collapsed-width)",
              } as CSSProperties}
            >
              <AppSidebar />
              <AppWorkspace>{children}</AppWorkspace>
            </SidebarProvider>
          </AuthGate>
        </TooltipProvider>
      </body>
    </html>
  );
}

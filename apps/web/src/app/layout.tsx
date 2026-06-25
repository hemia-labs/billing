import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { AuthGate } from "@/components/auth-gate";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
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
              <SidebarInset>
                <AppTopbar />
                <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
              </SidebarInset>
            </SidebarProvider>
          </AuthGate>
        </TooltipProvider>
      </body>
    </html>
  );
}

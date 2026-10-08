"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { BrandWordmark } from "@/components/brand-wordmark";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, LogOut, Moon, Sun } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/zuno/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/zuno/dropdown-menu";
import { Switch } from "@/components/zuno/switch";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { hasPermission, logout, useSession } from "@/components/auth-gate";
import { nav } from "@/lib/nav";

const groups = [
  { label: "General", routes: ["/", "/operations"] },
  { label: "Catálogo", routes: ["/products", "/addons"] },
  { label: "Gestión", routes: ["/invoices", "/webhooks", "/audit", "/integrations", "/settings"] },
];

export function AppSidebar() {
  const pathname = usePathname();
  const session = useSession();
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const name = session.user.name || session.user.email || session.user.ssoUserId;
  const initials = name.split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  function changeTheme(nextDark: boolean) {
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.classList.toggle("light", !nextDark);
    try {
      localStorage.setItem("billing-theme", nextDark ? "dark" : "light");
    } catch {
      // The selected theme still applies when browser storage is unavailable.
    }
    setDark(nextDark);
  }

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch {
      setLogoutError("No se pudo cerrar la sesión. Intenta nuevamente.");
      setLoggingOut(false);
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="group-data-[collapsible=icon]:px-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" aria-label="Hemia Billing" />}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--hemia-navy)] p-0.5 dark:bg-transparent dark:p-0 group-data-[collapsible=icon]:size-8">
                <Image src="/logo.png" alt="" width={96} height={66} className="h-auto w-full" />
              </span>
              <BrandWordmark className="group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          const items = nav.filter((item) =>
            group.routes.includes(item.href) && hasPermission(session, item.permission),
          );
          if (!items.length) return null;
          return (
            <SidebarGroup key={group.label} className="group-data-[collapsible=icon]:px-3">
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map(({ href, label, icon: Icon }) => {
                    const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
                    return (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton render={<Link href={href} />} isActive={active} tooltip={label}>
                          <Icon />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border group-data-[collapsible=icon]:px-3">
        {logoutError && <p className="px-2 text-xs text-destructive group-data-[collapsible=icon]:hidden" role="alert">{logoutError}</p>}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Abrir menú de usuario"
                className="flex h-12 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0"
              >
                <Avatar className="size-8 shrink-0" aria-hidden="true">
                  <AvatarFallback className="bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 flex-col text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-semibold text-sidebar-accent-foreground">{name}</span>
                  <span className="truncate text-xs">{session.user.email}</span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-3 py-2">
                    <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                    <p className="truncate text-xs font-normal text-muted-foreground">{session.user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="flex items-center gap-3 px-3 py-2 text-sm">
                    {dark ? <Moon className="size-4 text-muted-foreground" aria-hidden="true" /> : <Sun className="size-4 text-muted-foreground" aria-hidden="true" />}
                    <span>Tema</span>
                    <span className="ml-auto text-xs text-muted-foreground">{dark ? "Oscuro" : "Claro"}</span>
                    <Switch
                      aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
                      checked={dark}
                      onCheckedChange={changeTheme}
                    />
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="min-h-10 gap-3 px-3 text-sm font-medium text-destructive"
                    disabled={loggingOut}
                    onClick={() => void handleLogout()}
                  >
                    <LogOut className="size-4" />
                    {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

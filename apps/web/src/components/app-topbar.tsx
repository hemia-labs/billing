"use client";

import { Bell, LogOut, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { labelFor } from "@/lib/nav";
import { logout, useSession } from "@/components/auth-gate";

export function AppTopbar() {
  const title = labelFor(usePathname());
  const { user } = useSession();
  const name = user.name || user.email || user.ssoUserId;
  const initials = name
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-topbar shrink-0 items-center gap-4 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
      <SidebarTrigger aria-label="Abrir navegación" className="size-12 md:hidden" />
      <p className="text-lg font-semibold">{title}</p>
      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Buscar"
            className="h-12 w-64 pl-9"
            placeholder="Buscar..."
            type="search"
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={<Button aria-label="Notificaciones" className="size-12" size="icon" variant="ghost" />}
          >
            <Bell className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Notificaciones</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Abrir menú de usuario"
            render={<Button variant="ghost" size="icon" className="size-12" />}
          >
            <Avatar className="size-9" aria-hidden="true">
              <AvatarFallback className="bg-secondary text-xs font-bold text-primary">{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border border-border bg-card shadow-lg">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-3 py-2">
                <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={logout} className="min-h-12 gap-3 px-3 text-sm font-medium">
                <LogOut className="size-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

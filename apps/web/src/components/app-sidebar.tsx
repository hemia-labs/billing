"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { nav } from "@/lib/nav";

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="p-4 group-data-[collapsible=icon]:px-2">
        <div className="flex h-12 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-lg font-bold group-data-[collapsible=icon]:hidden">
            Hemia Billing
          </span>
          <SidebarTrigger
            aria-label="Colapsar navegación"
            className="hidden size-12 text-blue-50 hover:bg-white/10 hover:text-white [&_svg]:size-5! group-data-[collapsible=icon]:mx-auto md:inline-flex"
          />
        </div>
      </SidebarHeader>
      <SidebarContent className="px-4 py-2 group-data-[collapsible=icon]:px-2">
        <SidebarGroup className="p-0">
          <SidebarMenu className="gap-1">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={active}
                    size="lg"
                    tooltip={label}
                    className="text-blue-50/95 hover:bg-white/10 hover:text-white [&_svg]:size-5! data-active:bg-primary data-active:text-primary-foreground data-active:shadow-lg data-active:shadow-blue-950/25 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:w-12! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0!"
                  >
                    <Icon className="size-5" />
                    <span className="group-data-[collapsible=icon]:hidden">{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

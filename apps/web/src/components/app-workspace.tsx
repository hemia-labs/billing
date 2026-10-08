import type { ReactNode } from "react";
import { AppTopbar } from "@/components/app-topbar";
import { SidebarInset } from "@/components/ui/sidebar";
import { CopilotWorkspace } from "@/features/billing/copilot";

export function AppWorkspace({ children }: { children: ReactNode }) {
  return (
    <SidebarInset className="min-w-0">
      <CopilotWorkspace>
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopbar />
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
            <div className="min-h-full min-w-0 flex-1 rounded-xl bg-muted/50 p-4 md:p-6">
              {children}
            </div>
          </div>
        </div>
      </CopilotWorkspace>
    </SidebarInset>
  );
}

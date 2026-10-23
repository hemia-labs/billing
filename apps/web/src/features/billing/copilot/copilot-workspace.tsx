"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useSession } from "@/components/auth-gate";
import { useCopilot } from "./use-copilot";
import { CopilotProductPicker } from "./copilot-product-picker";
import {
  CopilotLauncherContext,
  ProductDraftContext,
  PlanDraftContext,
} from "./drafts/copilot-draft-context";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const CopilotChat = dynamic(
  () => import("./chat/copilot-chat").then((module) => module.CopilotChat),
  {
    loading: () => (
      <p role="status" className="p-4 text-xs text-muted-foreground">
        Abriendo MIA...
      </p>
    ),
  },
);

const compactQuery = "(max-width: 1279px)";
function subscribeToCompactViewport(onChange: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function isCompactViewport() {
  return window.matchMedia(compactQuery).matches;
}

export function CopilotWorkspace({ children }: { children: ReactNode }) {
  const session = useSession();
  return (
    <Workspace
      key={`${session.user.ssoUserId}:${session.organizationId ?? ""}`}
    >
      {children}
    </Workspace>
  );
}

function Workspace({ children }: { children: ReactNode }) {
  const [copilotOpen, setCopilotOpen] = useState(false);
  const launcherRef = useRef<HTMLElement | null>(null);
  const open = () => {
    launcherRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setCopilotOpen(true);
  };
  const copilot = useCopilot(copilotOpen);
  const compact = useSyncExternalStore(
    subscribeToCompactViewport,
    isCompactViewport,
    () => false,
  );
  const running = copilot.chat.messages.some(
    (message) => message.status === "running",
  );
  const close = () => {
    setCopilotOpen(false);
    requestAnimationFrame(() =>
      (launcherRef.current?.isConnected
        ? launcherRef.current
        : document.querySelector<HTMLElement>("[data-copilot-launcher]")
      )?.focus(),
    );
  };
  const chat = (
    <CopilotChat
      key={copilot.key}
      {...copilot.chat}
      onClose={close}
      taskContext={
        copilot.chat.agentId === "plan-draft" ? (
          <CopilotProductPicker
            key={copilot.productId ?? "choose"}
            productId={copilot.productId}
            onChange={copilot.changeProduct}
            disabled={running}
          />
        ) : undefined
      }
    />
  );

  return (
    <CopilotLauncherContext.Provider value={open}>
      <ProductDraftContext.Provider value={copilot.productContext}>
        <PlanDraftContext.Provider value={copilot.planContext}>
          <div className="flex min-w-0 flex-1">
            {children}
            {copilotOpen && !compact && (
              <aside
                aria-label="Chat de MIA"
                className="sticky top-0 flex h-dvh w-96 shrink-0 flex-col border-l border-border bg-card"
              >
                {chat}
              </aside>
            )}
          </div>
          {compact && copilotOpen && (
            <Sheet open={copilotOpen} onOpenChange={setCopilotOpen}>
              <SheetContent
                className="w-full max-w-[26rem] gap-0 p-0 sm:max-w-[26rem]"
                showCloseButton={false}
                side="right"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>MIA</SheetTitle>
                  <SheetDescription>
                    Tu asistente en Hemia Billing.
                  </SheetDescription>
                </SheetHeader>
                {chat}
              </SheetContent>
            </Sheet>
          )}
        </PlanDraftContext.Provider>
      </ProductDraftContext.Provider>
    </CopilotLauncherContext.Provider>
  );
}

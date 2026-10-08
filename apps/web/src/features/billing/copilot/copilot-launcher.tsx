"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/zuno/button";
import { useOpenCopilot } from "./copilot-draft-context";

export function CopilotLauncher({
  hasContent,
  disabled,
  requiresProduct = false,
}: {
  hasContent: boolean;
  disabled: boolean;
  requiresProduct?: boolean;
}) {
  const open = useOpenCopilot();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        data-copilot-launcher
        type="button"
        size="sm"
        variant="ghost"
        className="px-2 text-xs text-muted-foreground hover:text-foreground"
        disabled={disabled || requiresProduct}
        onClick={open}
      >
        <Sparkles aria-hidden="true" className="size-3.5" />
        {hasContent ? "Mejorar con MIA" : "Crear con MIA"}
      </Button>
      {requiresProduct && (
        <p className="text-xs text-muted-foreground">
          Selecciona un producto para usar MIA.
        </p>
      )}
    </div>
  );
}

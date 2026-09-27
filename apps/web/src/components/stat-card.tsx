import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/zuno/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  tone = "blue",
  icon,
}: {
  label: string;
  value: string;
  tone?: "blue" | "warning" | "error";
  icon?: ReactNode;
}) {
  const iconTone = {
    blue: "bg-zuno-info-surface text-zuno-info",
    warning: "bg-zuno-warning-surface text-zuno-warning",
    error: "bg-zuno-error-surface text-zuno-error",
  }[tone];

  return (
    <Card className="rounded-2xl border-surface-line shadow-sm">
      <CardContent className="p-6">
        <div className={cn("grid size-12 place-items-center rounded-full", iconTone)}>{icon}</div>
        <p className="mt-4 truncate text-sm font-bold text-heading">{label}</p>
        <p className="mt-2 font-display text-5xl font-semibold leading-none text-heading">{value}</p>
      </CardContent>
    </Card>
  );
}

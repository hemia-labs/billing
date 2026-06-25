import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  tone = "blue",
  icon,
}: {
  label: string;
  value: string;
  tone?: "blue" | "violet";
  icon?: ReactNode;
}) {
  return (
    <Card className="rounded-lg border border-border py-5 shadow-sm ring-0">
      <CardContent className="px-5">
        <div
          className={cn(
            "grid size-12 place-items-center rounded-full",
            tone === "violet" ? "bg-violet-50 text-violet-600" : "bg-secondary text-primary"
          )}
        >
          {icon}
        </div>
        <p className="mt-4 truncate text-sm font-bold">{label}</p>
        <p className="mt-2 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

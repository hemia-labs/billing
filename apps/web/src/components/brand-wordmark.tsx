import { azonix } from "@/app/fonts";
import { cn } from "@/lib/utils";

type BrandWordmarkProps = {
  className?: string;
  compact?: boolean;
};

export function BrandWordmark({ className, compact = false }: BrandWordmarkProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex min-w-0 shrink-0 flex-col justify-center text-foreground",
        compact ? "w-36" : "w-[174px] max-w-full",
        className,
      )}
    >
      <div className="flex items-baseline whitespace-nowrap leading-none">
        <span className={cn(azonix.className, "font-semibold", compact ? "text-[15px]" : "text-[18px]")}>HEMIA</span>
        <span className={cn(azonix.className, "font-normal tracking-[0.04em]", compact ? "ml-1 text-[15px]" : "ml-1.5 text-[18px]")}>BILLING</span>
      </div>
      <span className={cn(
        "whitespace-nowrap font-sans font-semibold uppercase leading-none text-muted-foreground",
        compact ? "mt-0.5 text-[7px] tracking-[0.1em]" : "mt-1 text-[8px] tracking-[0.14em]",
      )}>
        Consola de facturación
      </span>
    </div>
  );
}

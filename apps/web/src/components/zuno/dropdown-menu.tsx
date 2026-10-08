"use client"

import { type ComponentProps } from "react"
import { Check, ChevronRight } from "lucide-react"
import { Menu as BaseMenu } from "@base-ui/react/menu"
import { cn } from "@/lib/utils"

export const DropdownMenu = BaseMenu.Root
export const DropdownMenuTrigger = BaseMenu.Trigger
export const DropdownMenuGroup = BaseMenu.Group
export const DropdownMenuSub = BaseMenu.SubmenuRoot

export function DropdownMenuSubTrigger({ className, children, ...props }: BaseMenu.SubmenuTrigger.Props) {
  return (
    <BaseMenu.SubmenuTrigger
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-4 shrink-0" aria-hidden="true" />
    </BaseMenu.SubmenuTrigger>
  )
}

export function DropdownMenuSubContent({ className, side = "right", sideOffset = 2, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent className={cn("min-w-32", className)} side={side} sideOffset={sideOffset} {...props} />
}

// Positioner + Popup render through a portal. The Popup uses popover tokens so the menu keeps the
// correct Light/Dark surface when it opens over a table row or any other differently-themed context.
export function DropdownMenuContent({
  className,
  sideOffset = 6,
  side,
  align = "start",
  children,
  ...props
}: BaseMenu.Popup.Props & { sideOffset?: number; side?: BaseMenu.Positioner.Props["side"]; align?: BaseMenu.Positioner.Props["align"] }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner sideOffset={sideOffset} side={side} align={align} className="z-50 outline-none">
        <BaseMenu.Popup
          className={cn(
            "min-w-[8rem] origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
            "transition-[transform,opacity] duration-(--zuno-duration-fast) ease-(--zuno-ease-out) data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 motion-reduce:transition-none",
            className
          )}
          {...props}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: BaseMenu.Item.Props) {
  return (
    <BaseMenu.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export const DropdownMenuRadioGroup = BaseMenu.RadioGroup

export function DropdownMenuRadioItem({ className, children, ...props }: BaseMenu.RadioItem.Props) {
  return (
    <BaseMenu.RadioItem
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-sm text-popover-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <BaseMenu.RadioItemIndicator><Check className="size-4" /></BaseMenu.RadioItemIndicator>
      </span>
      {children}
    </BaseMenu.RadioItem>
  )
}

// A standalone section heading. For a semantically grouped label, wrap items in DropdownMenuGroup
// (Base UI Menu.Group) and use BaseMenu.GroupLabel, which requires that group context.
export function DropdownMenuLabel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: BaseMenu.Separator.Props) {
  return <BaseMenu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}

"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useHasPermission } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";

export function ProductCreateAction() {
  if (!useHasPermission("billing.catalog.manage")) return null;

  return (
    <Button className="h-11 w-fit gap-2 whitespace-nowrap px-4 font-semibold" render={<Link href="/products/new" />}>
      <Plus className="size-5" />
      Nuevo producto
    </Button>
  );
}

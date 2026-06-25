import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function AppBreadcrumb({ title }: { title: string }) {
  return (
    <Breadcrumb className="mb-3 text-sm font-semibold text-primary">
      <BreadcrumbList className="gap-0 text-primary">
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href="/" />}>Hemia</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="mx-2 text-muted-foreground">/</BreadcrumbSeparator>
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="truncate font-semibold text-muted-foreground">{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

import Link from "next/link";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type AppBreadcrumbItem = {
  href?: string;
  label: string;
};

export function AppBreadcrumb({
  items,
  title,
}: {
  items?: AppBreadcrumbItem[];
  title: string;
}) {
  const breadcrumbItems = items ?? [{ href: "/", label: "Hemia" }, { label: title }];

  return (
    <Breadcrumb className="mb-3 text-sm font-semibold text-primary">
      <BreadcrumbList className="gap-0 text-primary">
        {breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1;

          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 ? <BreadcrumbSeparator className="mx-2 text-muted-foreground">/</BreadcrumbSeparator> : null}
              <BreadcrumbItem className="min-w-0">
                {isLast || !item.href ? (
                  <BreadcrumbPage className="truncate font-semibold text-muted-foreground">{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={item.href} />}>{item.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export type { AppBreadcrumbItem };

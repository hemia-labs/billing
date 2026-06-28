import type { ReactNode } from "react";
import { AppBreadcrumb, type AppBreadcrumbItem } from "@/components/app-breadcrumb";

export function PageHeading({
  actions,
  breadcrumbItems,
  description,
  title,
  titlePrefix,
  titleSuffix,
}: {
  actions?: ReactNode;
  breadcrumbItems?: AppBreadcrumbItem[];
  description: string;
  title: string;
  titlePrefix?: ReactNode;
  titleSuffix?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div className="min-w-0">
        <AppBreadcrumb items={breadcrumbItems} title={title} />
        <div className="flex min-w-0 items-center gap-3">
          {titlePrefix}
          <h1 className="truncate text-3xl font-bold tracking-normal md:text-4xl">{title}</h1>
          {titleSuffix}
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-supporting md:text-base">
          {description}
        </p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

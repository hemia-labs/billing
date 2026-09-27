import type { ReactNode } from "react";
import { AppBreadcrumb, type AppBreadcrumbItem } from "@/components/app-breadcrumb";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderHeading,
} from "@/components/zuno/page-header";

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
    <PageHeader className="mb-6 items-start sm:items-end">
      <PageHeaderContent>
        {breadcrumbItems && <AppBreadcrumb items={breadcrumbItems} title={title} />}
        <div className="flex min-w-0 items-center gap-3">
          {titlePrefix}
          <PageHeaderHeading className="truncate text-2xl font-bold text-heading">{title}</PageHeaderHeading>
          {titleSuffix}
        </div>
        <PageHeaderDescription className="max-w-3xl text-supporting">{description}</PageHeaderDescription>
      </PageHeaderContent>
      {actions && <PageHeaderActions>{actions}</PageHeaderActions>}
    </PageHeader>
  );
}

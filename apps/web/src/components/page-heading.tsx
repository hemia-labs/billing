import { AppBreadcrumb } from "@/components/app-breadcrumb";

export function PageHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="mb-6">
      <AppBreadcrumb title={title} />
      <h1 className="text-3xl font-bold tracking-normal md:text-4xl">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-supporting md:text-base">
        {description}
      </p>
    </div>
  );
}

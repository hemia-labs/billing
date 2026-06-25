import { PageHeading } from "@/components/page-heading";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <PageHeading
        description="Cargando información de Billing."
        title="Resumen"
      />
      <Card className="rounded-lg border border-border py-0 shadow-sm ring-0">
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-4/5 max-w-lg" />
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import { PlanNewClient } from "@/features/billing/catalog/plans/plan-new-client";

export const metadata: Metadata = {
  title: "Nuevo plan",
};

export default function NewPlanPage() {
  return <PlanNewClient />;
}

"use client";

import { createContext, useContext } from 'react';
import type { CatalogProductPayload } from '../../catalog/catalog-api';
import type { PlanDraft, PlanFormDraft } from '../copilot-types';

export const CopilotLauncherContext = createContext<() => void>(() => {});
export function useOpenCopilot() { return useContext(CopilotLauncherContext); }

export const ProductDraftContext = createContext<{
  draft: { id: string; product: CatalogProductPayload } | null;
  currentProduct: CatalogProductPayload | null;
  setCurrentProduct: (product: CatalogProductPayload) => void;
  clear: () => Promise<void>;
}>({ draft: null, currentProduct: null, setCurrentProduct: () => {}, clear: () => Promise.resolve() });

export const PlanDraftContext = createContext<{
  draft: { id: string; plan: PlanDraft } | null;
  currentPlan: PlanFormDraft | null;
  setCurrentPlan: (plan: PlanFormDraft) => void;
  clear: () => Promise<void>;
}>({ draft: null, currentPlan: null, setCurrentPlan: () => {}, clear: () => Promise.resolve() });

export function useProductDraft() { return useContext(ProductDraftContext); }
export function usePlanDraft() { return useContext(PlanDraftContext); }

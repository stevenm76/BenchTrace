"use client";

import { useContext } from "react";

import { TierContext, type TierContextValue } from "./TierProvider";

export function useTier(): TierContextValue {
  const ctx = useContext(TierContext);
  if (!ctx) {
    throw new Error("useTier must be used within <TierProvider>");
  }
  return ctx;
}

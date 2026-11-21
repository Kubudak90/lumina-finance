"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/providers/ThemeProvider";

/** Sonner with the resolved theme, after hydration (dark before, as the server renders it). */
export function ThemedToaster() {
  const { resolved, mounted } = useTheme();
  return <Toaster position="bottom-right" richColors theme={mounted ? resolved : "dark"} />;
}

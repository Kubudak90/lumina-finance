"use client";

import { create } from "zustand";
import type { ReadOnlyAccountExistence } from "../existence";

/** Read-only account state for the Lumina views (lighter-ts has no "read-only" state). */
export const useReadOnlyStore = create<{ existence: ReadOnlyAccountExistence }>(() => ({ existence: "Deciding" }));

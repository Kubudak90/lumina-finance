"use client";

import type { Persistence } from "lighter-ts";

export const persistence: Persistence = {
  setItem: (...args) => localStorage.setItem(...args),
  getItem: (...args) => localStorage.getItem(...args),
};

"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 5_000;

let clock = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function start() {
  if (timer !== null) return;
  // Set before subscribe returns so useSyncExternalStore re-reads a real timestamp.
  clock = Date.now();
  timer = setInterval(() => {
    clock = Date.now();
    emit();
  }, TICK_MS);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getClock() {
  return clock;
}

/** Client clock for freshness checks. `Date.now` stays outside render. */
export function useFreshnessNow(): number {
  return useSyncExternalStore(subscribe, getClock, () => 0);
}

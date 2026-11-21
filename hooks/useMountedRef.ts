"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/** Layout effect in the browser, plain effect during SSR (no server warning). */
export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * `ref.current` is true while the component is mounted. It flips in a LAYOUT effect, i.e. during
 * the commit that unmounts the component, not later with the passive effects: a non-urgent commit
 * schedules passive cleanups for a later task, and an awaited read that resolves in between (a
 * microtask) must already see the dialog as closed, or it opens a wallet prompt for a dialog that
 * is gone (U4 review r1 #4).
 */
export function useMountedRef() {
  const mounted = useRef(false);
  useIsomorphicLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

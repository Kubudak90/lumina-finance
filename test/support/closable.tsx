/**
 * Close (unmount) a dialog the way the app can: one state update of its parent, committed by
 * React's scheduler — not inside act(), not a discrete event. For such a commit React runs layout
 * cleanups during the commit but leaves the passive cleanups (useEffect) to a LATER task, so a
 * promise that resolves at the commit continues (microtasks) BEFORE they run: the post-commit
 * window of U4 review r1 #4. Testing Library's `unmount()` wraps the unmount in act(), which
 * flushes the passive cleanups at once and hides the window.
 */
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { render } from "@testing-library/react";

export interface ClosableProbe {
  /** A passive (useEffect) cleanup inside the closed subtree has run. */
  passiveCleanupRan: boolean;
  /**
   * Whether that passive cleanup had already run when the microtasks queued at the closing commit
   * ran: false proves the test exercised the window (true would mean act() or a sync commit).
   */
  passiveRanBeforeCommitMicrotasks: boolean | undefined;
}

/**
 * Render `children` under a parent that can close them. `atCommit` runs in a layout effect of the
 * closing commit (e.g. release a held read): whatever it resumes runs before the passive cleanups.
 */
export function renderClosable(children: ReactNode, atCommit: () => void) {
  let close: () => void = () => {
    throw new Error("not rendered");
  };
  const probe: ClosableProbe = { passiveCleanupRan: false, passiveRanBeforeCommitMicrotasks: undefined };

  function PassiveProbe() {
    useEffect(
      () => () => {
        probe.passiveCleanupRan = true;
      },
      [],
    );
    return null;
  }

  function Harness() {
    const [open, setOpen] = useState(true);
    close = () => setOpen(false);
    useLayoutEffect(() => {
      if (open) return;
      atCommit();
      queueMicrotask(() => {
        probe.passiveRanBeforeCommitMicrotasks = probe.passiveCleanupRan;
      });
    }, [open]);
    return open ? (
      <>
        {children}
        <PassiveProbe />
      </>
    ) : null;
  }

  const view = render(<Harness />);
  return {
    view,
    probe,
    /** Close outside act() and wait (real time) until the commit and its passive cleanups ran. */
    async closeOutsideAct() {
      const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
      const previous = env.IS_REACT_ACT_ENVIRONMENT;
      env.IS_REACT_ACT_ENVIRONMENT = false; // a real update, scheduled by React (no act() warnings)
      try {
        close();
        for (let i = 0; i < 200 && !probe.passiveCleanupRan; i++) await new Promise((r) => setTimeout(r, 5));
        // Let whatever the closing commit resumed finish.
        await new Promise((r) => setTimeout(r, 20));
      } finally {
        env.IS_REACT_ACT_ENVIRONMENT = previous;
      }
      if (!probe.passiveCleanupRan) throw new Error("the dialog did not close");
    },
  };
}

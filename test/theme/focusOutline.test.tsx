// @vitest-environment happy-dom
/**
 * Focusable elements keep a focus-scoped solid transparent outline next to their ring, so forced
 * colours mode paints a visible focus indicator (spec ui-light-theme §3.1, r2 #2). The shadcn
 * primitives build their classes through cn() (tailwind-merge), which must not drop `outline`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const FOCUS = ["focus-visible:outline", "focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-transparent"];
const classes = (el: Element) => el.className.split(/\s+/);

afterEach(() => cleanup());

describe("focus outlines (forced colours)", () => {
  it("cn() keeps the Tailwind 3.4 outline style next to its width, and still merges real conflicts", () => {
    expect(cn(FOCUS.join(" ")).split(" ")).toEqual(FOCUS);
    expect(cn("outline outline-dashed")).toBe("outline-dashed");
    expect(cn("outline-2 outline-4")).toBe("outline-4");
    expect(cn("text-success-strong", "text-destructive-strong")).toBe("text-destructive-strong");
  });

  it("Button, Input and the dialog popup render all four outline classes and no outline-none", () => {
    render(
      <>
        <Button>Go</Button>
        <Input aria-label="Amount" className="bg-transparent border-border" />
        <Dialog open>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
      </>,
    );
    const popup = document.querySelector('[data-slot="dialog-content"]')!;
    // The open modal dialog hides the rest from the accessibility tree, hence `hidden: true`.
    for (const el of [screen.getByRole("button", { name: "Go", hidden: true }), screen.getByLabelText("Amount"), popup]) {
      expect(classes(el)).toEqual(expect.arrayContaining(FOCUS));
      expect(classes(el)).not.toContain("outline-none");
    }
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
    expect(classes(overlay)).toContain("bg-dialog-scrim");
  });
});

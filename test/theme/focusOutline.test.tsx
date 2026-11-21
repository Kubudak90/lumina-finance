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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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

  it("cn() treats the theme's CTA glows as box shadows (LT fix r1 #5)", () => {
    expect(cn("shadow-cta", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-none", "shadow-cta-lg")).toBe("shadow-cta-lg");
    expect(cn("shadow-cta", "shadow-cta-lg")).toBe("shadow-cta-lg");
    expect(cn("shadow-sm", "shadow-cta")).toBe("shadow-cta");
  });

  it("Button keeps its 2 px opaque ring and card-coloured offset under a CTA's classes (r1 #2)", () => {
    // TxButton's className, as it is merged into the Button through cn().
    render(
      <Button className="w-full py-4 text-base bg-accent text-accent-foreground font-bold uppercase tracking-[0.2em] shadow-cta hover:bg-accent-hover">
        Supply
      </Button>,
    );
    const ring = ["focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2", "focus-visible:ring-offset-card"];
    expect(classes(screen.getByRole("button", { name: "Supply" }))).toEqual(expect.arrayContaining([...ring, ...FOCUS, "shadow-cta"]));
  });

  it("the sheet overlay uses its own scrim token (dark keeps today's black/10, r1 #6)", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(classes(document.querySelector('[data-slot="sheet-overlay"]')!)).toContain("bg-sheet-scrim");
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

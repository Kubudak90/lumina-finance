import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge, validators } from "tailwind-merge"

/**
 * tailwind-merge 3 follows Tailwind 4, where a bare `outline` sets the outline width, so it would drop
 * `outline` next to `outline-2`. This app runs Tailwind 3.4, where `outline` sets `outline-style: solid`:
 * the focus-scoped solid transparent outline that forced-colours mode paints (spec ui-light-theme §3.1).
 */
const twMerge = extendTailwindMerge({
  override: {
    classGroups: {
      "outline-w": [{ outline: [validators.isNumber, validators.isArbitraryVariableLength, validators.isArbitraryLength] }],
    },
  },
  extend: {
    classGroups: {
      "outline-style": [{ outline: [""] }],
      // The theme's CTA glows (tailwind.config boxShadow), so a later shadow-* replaces them.
      shadow: [{ shadow: ["cta", "cta-lg"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Compiles CSS with the app's real Tailwind config (only the `content` is replaced), so tests can
 * check what the browser actually receives: which classes emit rules, and with which selectors.
 */
import postcss, { type Rule } from "postcss";
import tailwindcss from "tailwindcss";
import tailwindConfig from "@/tailwind.config";

/** Utilities generated for the given class names, or for the given source files. */
export async function compileUtilities(content: { raw?: string; files?: string[] }): Promise<string> {
  const sources = [...(content.files ?? []), ...(content.raw ? [{ raw: content.raw, extension: "html" }] : [])];
  const result = await postcss([tailwindcss({ ...tailwindConfig, content: sources })]).process("@tailwind utilities;", {
    from: undefined,
  });
  return result.css;
}

export interface CompiledRule {
  selector: string;
  /** Enclosing at-rule preludes, outermost first (e.g. "media (prefers-color-scheme: dark)"). */
  atRules: string[];
  declarations: Record<string, string>;
  /** Position in the stylesheet (later wins at equal specificity). */
  order: number;
}

export function rules(css: string): CompiledRule[] {
  const out: CompiledRule[] = [];
  postcss.parse(css).walkRules((rule: Rule) => {
    const atRules: string[] = [];
    for (let p = rule.parent; p && p.type === "atrule"; p = p.parent) atRules.unshift(`${p.name} ${p.params}`);
    const declarations: Record<string, string> = {};
    rule.walkDecls((d) => {
      declarations[d.prop] = d.value.trim();
    });
    for (const selector of rule.selectors) out.push({ selector, atRules, declarations, order: out.length });
  });
  return out;
}

/** The escaped CSS class selector of a Tailwind class name (".focus-visible\:ring-2"). */
export function classSelector(name: string): string {
  return `.${name.replace(/([^\w-])/g, "\\$1")}`;
}

/** Rules whose selector contains the class (any variant pseudo-classes or ancestors around it). */
export function rulesFor(css: string, name: string): CompiledRule[] {
  const cls = classSelector(name);
  return rules(css).filter((r) => {
    const i = r.selector.indexOf(cls);
    return i >= 0 && !/[\w\\-]/.test(r.selector[i + cls.length] ?? "");
  });
}

/** Removes `fn(...)` groups (balanced parentheses) and returns the rest; `keepInner` keeps the argument. */
function unwrap(selector: string, fn: string, keepInner: boolean): string {
  let s = selector;
  for (let i = s.indexOf(fn); i >= 0; i = s.indexOf(fn)) {
    let depth = 0;
    let j = i + fn.length - 1;
    for (; j < s.length; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")" && --depth === 0) break;
    }
    s = s.slice(0, i) + (keepInner ? ` ${s.slice(i + fn.length, j)} ` : "") + s.slice(j + 1);
  }
  return s;
}

/**
 * Selector specificity [ids, classes, types] for the simple selectors Tailwind emits: :where() counts
 * zero, :not()/:is() count their argument, escaped characters inside class names are ignored.
 */
export function specificity(selector: string): [number, number, number] {
  let s = selector.replace(/\\./g, "_");
  s = unwrap(s, ":where(", false);
  s = unwrap(s, ":not(", true);
  s = unwrap(s, ":is(", true);
  let classes = (s.match(/\[[^\]]*\]/g) ?? []).length;
  s = s.replace(/\[[^\]]*\]/g, "");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const pseudoElements = (s.match(/::[\w-]+/g) ?? []).length;
  s = s.replace(/::[\w-]+/g, "");
  classes += (s.match(/\.[\w-]+/g) ?? []).length + (s.match(/:[\w-]+/g) ?? []).length;
  s = s.replace(/[.#:][\w-]+/g, "");
  const types = (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length + pseudoElements;
  return [ids, classes, types];
}

export function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

import { THEME_INIT_SCRIPT } from "@/lib/theme/theme";

/** The inline `<head>` script that applies a stored Light/Dark choice before first paint (spec §3.3). */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}

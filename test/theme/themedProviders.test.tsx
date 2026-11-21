// @vitest-environment happy-dom
/**
 * RainbowKit and the Toaster follow the resolved theme after hydration, and the server markup is the
 * same for every stored choice and OS preference (spec ui-light-theme §3.3, §5 #4, §6 #1).
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAINBOW_ACCENTS } from "@/lib/theme/theme";
import { installMatchMedia, installStorage, resetHtml, type FakeMedia } from "../support/themeEnv";

const themes = vi.hoisted(() => ({
  light: vi.fn((options: object) => ({ name: "light", ...options })),
  dark: vi.fn((options: object) => ({ name: "dark", ...options })),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  getDefaultConfig: (cfg: unknown) => cfg,
  lightTheme: themes.light,
  darkTheme: themes.dark,
  RainbowKitProvider: ({ theme, children }: { theme: { name: string }; children: ReactNode }) => (
    <div data-testid="rainbowkit" data-rk-theme={theme.name}>
      {children}
    </div>
  ),
}));
vi.mock("@rainbow-me/rainbowkit/wallets", () => ({
  injectedWallet: "injectedWallet",
  rainbowWallet: "rainbowWallet",
  walletConnectWallet: "walletConnectWallet",
}));
vi.mock("@rainbow-me/rainbowkit/styles.css", () => ({}));
vi.mock("wagmi", () => ({
  WagmiProvider: ({ children }: { children: ReactNode }) => children,
  http: () => "HTTP",
  custom: () => "CUSTOM",
}));
vi.mock("sonner", () => ({
  Toaster: ({ theme }: { theme: string }) => <div data-testid="toaster" data-toaster-theme={theme} />,
}));

const KEY = "lumina.theme";

async function load() {
  vi.resetModules();
  const { ThemeProvider } = await import("@/providers/ThemeProvider");
  const { Web3Provider } = await import("@/providers/Web3Provider");
  const { ThemedToaster } = await import("@/components/theme/ThemedToaster");
  const store = await import("@/lib/theme/store");
  const tree = (
    <ThemeProvider>
      <Web3Provider>
        <span>app</span>
        <ThemedToaster />
      </Web3Provider>
    </ThemeProvider>
  );
  return { tree, store };
}

const rk = () => screen.getByTestId("rainbowkit").getAttribute("data-rk-theme");
const toaster = () => screen.getByTestId("toaster").getAttribute("data-toaster-theme");

let media: FakeMedia;
beforeEach(() => {
  resetHtml();
  media = installMatchMedia(false);
  themes.light.mockClear();
  themes.dark.mockClear();
});
afterEach(() => cleanup());

async function hydrate(tree: ReactNode) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree);
  document.body.appendChild(container);
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
  await act(async () => {
    hydrateRoot(container, tree, { onRecoverableError: (error) => errors.push(error) });
  });
  spy.mockRestore();
  return { container, errors };
}

describe("RainbowKit and the Toaster follow the theme", () => {
  it("builds both RainbowKit themes with the spec accents", async () => {
    installStorage();
    await load();
    expect(themes.dark).toHaveBeenCalledWith({ ...RAINBOW_ACCENTS.dark, borderRadius: "none", overlayBlur: "small" });
    expect(themes.light).toHaveBeenCalledWith({ ...RAINBOW_ACCENTS.light, borderRadius: "none", overlayBlur: "small" });
    expect(RAINBOW_ACCENTS.dark).toEqual({ accentColor: "#B0C4FF", accentColorForeground: "#09090b" });
    expect(RAINBOW_ACCENTS.light.accentColorForeground).toBe("#ffffff");
  });

  it("renders the same dark markup on the server for every stored choice and OS preference", async () => {
    const markup = new Set<string>();
    for (const stored of ["light", "dark", "system", "bogus"]) {
      for (const dark of [true, false]) {
        installMatchMedia(dark);
        installStorage({ [KEY]: stored });
        markup.add(renderToString((await load()).tree));
      }
    }
    expect(markup.size).toBe(1);
    const [html] = [...markup];
    expect(html).toContain('data-rk-theme="dark"');
    expect(html).toContain('data-toaster-theme="dark"');
  });

  it("switches to the resolved theme after hydration, without a hydration mismatch", async () => {
    for (const [stored, osDark, expected] of [
      ["light", true, "light"],
      ["dark", false, "dark"],
      ["system", false, "light"],
      ["system", true, "dark"],
    ] as const) {
      installMatchMedia(osDark);
      installStorage({ [KEY]: stored });
      const { container, errors } = await hydrate((await load()).tree);
      expect(errors, `${stored}/${osDark}`).toEqual([]);
      expect([rk(), toaster()], `${stored}/${osDark}`).toEqual([expected, expected]);
      container.remove();
    }
  });

  it("follows a new choice and, under system, the OS", async () => {
    installStorage({ [KEY]: "system" });
    const { tree, store } = await load();
    render(tree);
    expect([rk(), toaster()]).toEqual(["light", "light"]);
    act(() => media.setDark(true));
    expect([rk(), toaster()]).toEqual(["dark", "dark"]);
    act(() => store.writePreference("light"));
    expect([rk(), toaster()]).toEqual(["light", "light"]);
    act(() => media.setDark(false));
    act(() => media.setDark(true));
    expect([rk(), toaster()]).toEqual(["light", "light"]);
  });
});

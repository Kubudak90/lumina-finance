import { describe, expect, it } from "vitest";
import { WALLETCONNECT_CONNECT_SRC, buildCsp, rpcOrigin, securityHeaders } from "./csp.mjs";
import nextConfig from "../../next.config.mjs";

function directive(csp: string, name: string): string[] {
  const part = csp.split("; ").find((p) => p.startsWith(`${name} `));
  return part ? part.slice(name.length + 1).split(" ") : [];
}

describe("CSP and anti-framing headers (FE-02)", () => {
  const csp = buildCsp({ rpcUrl: "https://user:secret@rpc.devnet.example:8443/v1/key?x=1" });

  it("forbids framing", () => {
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    const headers = Object.fromEntries(securityHeaders({}).map((h) => [h.key, h.value]));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(headers["Permissions-Policy"]).toMatch(/payment=\(\)/);
  });

  it("allows only the RPC origin (no path, no credentials) and WalletConnect for connections", () => {
    const connect = directive(csp, "connect-src");
    expect(connect).toContain("https://rpc.devnet.example:8443");
    expect(csp).not.toMatch(/secret|\/v1\/key/);
    for (const origin of WALLETCONNECT_CONNECT_SRC) expect(connect).toContain(origin);
    expect(connect.every((src) => src === "'self'" || /^(https|wss):\/\/[a-z0-9.-]+(:\d+)?$/.test(src))).toBe(true);
    expect(connect).not.toContain("*");
    expect(csp).not.toMatch(/coingecko|jsdelivr/);
  });

  it("ships exactly this origin list (compared as a whole, Codex #14)", () => {
    const shipped = buildCsp({ rpcUrl: "https://rpc.devnet.example" });
    expect(directive(shipped, "connect-src")).toEqual([
      "'self'",
      "https://rpc.devnet.example",
      "wss://relay.walletconnect.org",
      "wss://relay.walletconnect.com",
      "https://rpc.walletconnect.org",
      "https://rpc.walletconnect.com",
      "https://verify.walletconnect.org",
      "https://verify.walletconnect.com",
      "https://pulse.walletconnect.org",
      "https://mainnet.zklighter.elliot.ai",
      "wss://mainnet.zklighter.elliot.ai",
    ]);
    expect(directive(shipped, "frame-src")).toEqual(["https://verify.walletconnect.org", "https://verify.walletconnect.com"]);
    expect(directive(shipped, "script-src")).toEqual(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]);
    expect(directive(shipped, "img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directive(shipped, "font-src")).toEqual(["'self'", "data:"]);
    expect(directive(shipped, "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(shipped.split("; ").map((d) => d.split(" ")[0])).toEqual([
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "frame-src",
      "worker-src",
      "manifest-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
      "upgrade-insecure-requests",
    ]);
    // No MetaMask SDK relay: MetaMask mobile goes through WalletConnect (Codex #12).
    expect(shipped).not.toMatch(/metamask/i);
  });

  it("locks down scripts, objects and forms", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(buildCsp({ dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("accepts only https RPC origins (http for loopback only)", () => {
    expect(rpcOrigin("https://rpc.example")).toBe("https://rpc.example");
    expect(rpcOrigin("http://127.0.0.1:8545")).toBe("http://127.0.0.1:8545");
    expect(rpcOrigin("http://rpc.example")).toBeNull();
    expect(rpcOrigin("javascript:alert(1)")).toBeNull();
    expect(rpcOrigin(undefined)).toBeNull();
    expect(directive(buildCsp({ rpcUrl: "http://rpc.example" }), "connect-src")).not.toContain("http://rpc.example");
  });

  it("sets HSTS and COOP with the spec values (N-FE-04)", async () => {
    const headers = Object.fromEntries(securityHeaders({}).map((h) => [h.key, h.value]));
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");

    const routes = await nextConfig.headers!();
    const routeHeaders = Object.fromEntries(routes[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(routeHeaders["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(routeHeaders["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
  });

  it("is applied to every route by next.config headers()", async () => {
    const routes = await nextConfig.headers!();
    expect(routes).toHaveLength(1);
    expect(routes[0].source).toBe("/:path*");
    const keys = routes[0].headers.map((h: { key: string }) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Content-Security-Policy",
        "X-Frame-Options",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Strict-Transport-Security",
        "Cross-Origin-Opener-Policy",
      ]),
    );
  });
});

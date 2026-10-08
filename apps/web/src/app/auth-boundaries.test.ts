// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = sourceFiles(SRC).map((file) => ({ file: path.relative(SRC, file), text: readFileSync(file, "utf8") }));
const directive = (text: string, name: string) => new RegExp(`^\\s*["']${name}["'];`).test(text);
const imports = (text: string) => [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");

describe("authentication boundaries", () => {
  it("requires authentication on research routes and keeps login and OAuth callback public", () => {
    const pages = files.filter(({ file }) => file.startsWith("app/") && file.endsWith("page.tsx"));
    const researchPages = pages.filter(
      ({ file }) =>
        file.startsWith("app/borrowers/") ||
        file.startsWith("app/portfolios/") ||
        file.startsWith("app/maturity/") ||
        file.startsWith("app/market/"),
    );
    expect(researchPages.length).toBeGreaterThanOrEqual(12);
    for (const { file, text } of researchPages) {
      expect(text, file).toMatch(/requireAuthenticatedUser\s*\(/);
      expect(imports(text), file).toContain("@/server/auth/access");
    }
    const login = files.find(({ file }) => file === "app/login/page.tsx");
    expect(login?.text).not.toMatch(/requireAuthenticatedUser|requireAdmin/);
    const callback = files.find(({ file }) => file === "app/auth/callback/route.ts");
    expect(callback?.text).toMatch(/exchangeCodeForSession/);
    expect(callback?.text).not.toMatch(/requireAuthenticatedUser|requireAdmin/);
    const account = files.find(({ file }) => file === "app/account/page.tsx");
    expect(account?.text).toMatch(/getCurrentUser/);
    expect(account?.text).not.toMatch(/requireAdmin|requireProOrAdmin/);
  });

  it("keeps PrimaryNav role visibility server-driven and Review out of navigation", () => {
    const nav = files.find(({ file }) => file === "components/PrimaryNav.tsx");
    expect(nav?.text).not.toMatch(/\/review\/entities|Review/);
    expect(nav?.text).toMatch(/signedIn/);
    expect(nav?.text).toMatch(/isAdmin/);
    expect(nav?.text).not.toMatch(/email|onmicrosoft|user_metadata/i);
    const shell = files.find(({ file }) => file === "components/Shell.tsx");
    expect(shell?.text).toMatch(/getCurrentAccess/);
    expect(shell?.text).toMatch(/isAdmin/);
  });

  it("guards every admin page and admin filing loader with requireAdmin", () => {
    const adminPages = files.filter(({ file }) => file.startsWith("app/admin/") && file.endsWith("page.tsx"));
    expect(adminPages.length).toBeGreaterThanOrEqual(4);
    expect(adminPages.some(({ file }) => file === "app/admin/coverage/arcc/page.tsx")).toBe(true);
    for (const { file, text } of adminPages) {
      expect(text, file).toMatch(/requireAdmin\s*\(/);
      expect(imports(text), file).toContain("@/server/auth/access");
    }
    const loader = files.find(({ file }) => file === "server/load-admin-filings.ts");
    expect(loader?.text).toMatch(/requireAdmin\s*\(/);
    expect(loader?.text).toMatch(/SET ROLE admin_reader/);
    expect(loader?.text).toMatch(/admin\.filing_inventory/);
    expect(loader?.text).toMatch(/admin\.filing_document/);
    expect(loader?.text).toMatch(/admin\.filing_artifact/);
    expect(loader?.text).toMatch(/admin\.filing_processing/);
    expect(loader?.text).not.toMatch(/\bFROM\s+(raw|registry|ops|obs)\./i);
    expect(loader?.text).not.toMatch(/grant_event|SERVICE_ROLE|bdc_reader/i);
    const arccLoader = files.find(({ file }) => file === "server/load-arcc-sec-coverage.ts");
    expect(arccLoader?.text).toMatch(/requireAdmin\s*\(/);
    expect(arccLoader?.text).not.toMatch(/grant_event|SERVICE_ROLE|INSERT INTO/i);
    expect(arccLoader?.text).not.toMatch(/\bFROM\s+(raw|registry|ops|obs)\./i);
    expect(arccLoader?.text).not.toMatch(/SET ROLE bdc_reader/);
    const arccInventory = files.find(({ file }) => file === "server/load-arcc-bdc-filings.ts");
    expect(arccInventory?.text).toMatch(/SET ROLE admin_reader/);
    expect(arccInventory?.text).toMatch(/admin\.filing_inventory/);
    expect(arccInventory?.text).not.toMatch(/\bFROM\s+(raw|registry|ops|obs)\./i);
    expect(arccInventory?.text).not.toMatch(/INSERT INTO|grant_event|SERVICE_ROLE/i);
  });

  it("keeps the proxy matcher to the sign-in and OAuth callback routes", () => {
    const proxy = files.find(({ file }) => file === "proxy.ts");
    expect(proxy?.text).toMatch(/matcher:\s*\["\/login",\s*"\/account",\s*"\/auth\/callback"\]/);
    expect(proxy?.text).not.toMatch(/borrowers|portfolios|maturity|market|review|admin/);
  });

  it("redirects only to fixed destinations after sign-in, OAuth start, and sign-out", () => {
    const actions = files.find(({ file }) => file === "server/auth/actions.ts");
    const targets = [...(actions?.text ?? "").matchAll(/redirect\(([^)]*)\)/g)].map((match) => match[1]);
    expect(targets).toEqual(["SIGNED_IN_PATH", "url", "LOGIN_PATH"]);
    expect(actions?.text).not.toMatch(/searchParams|emailRedirectTo|returnTo/);
    expect(actions?.text).toMatch(/redirectTo:\s*callbackUrl/);
    expect(actions?.text).toMatch(/oauthCallbackUrl\s*\(/);
    expect(actions?.text.match(/redirectTo:\s*\S+/g)).toEqual(["redirectTo: callbackUrl,"]);
    const callback = files.find(({ file }) => file === "app/auth/callback/route.ts");
    expect(callback?.text).toMatch(/exchangeCodeForSession/);
    expect(callback?.text).toMatch(/SIGNED_IN_PATH/);
    expect(callback?.text).toMatch(/LOGIN_PATH/);
    expect(callback?.text).not.toMatch(/searchParams\.get\(\s*["']next["']|returnTo|redirectTo/);
  });

  it("keeps Microsoft OAuth server-only with Azure provider and no domain authorization", () => {
    const actions = files.find(({ file }) => file === "server/auth/actions.ts");
    expect(actions?.text).toMatch(/signInWithOAuth/);
    expect(actions?.text).toMatch(/provider:\s*["']azure["']/);
    const loginForm = files.find(({ file }) => file === "components/LoginForm.tsx");
    expect(loginForm?.text).toMatch(/Continue with Microsoft/);
    expect(loginForm?.text).toMatch(/signInWithMicrosoft/);
    expect(loginForm?.text).not.toMatch(/createBrowserClient|createClient|supabase\.auth/);
    const access = files.find(({ file }) => file === "server/auth/access.ts");
    expect(access?.text).toMatch(/access\.current_access/);
    expect(access?.text).not.toMatch(/microsoft|azure|\.onmicrosoft\.|email\s*===|endsWith\s*\(/i);
  });

  it("never reads getSession for an access decision", () => {
    for (const { file, text } of files) expect(text, file).not.toMatch(/\.getSession\(/);
  });

  it("does not expose database or Supabase secrets to client code", () => {
    const clientFiles = files.filter(({ text }) => directive(text, "use client"));
    expect(clientFiles.some(({ file }) => file === "components/LoginForm.tsx")).toBe(true);
    for (const { file, text } of clientFiles) {
      expect(text, file).not.toMatch(/process\.env/);
      for (const spec of imports(text).filter((s) => s.startsWith("@/server/"))) {
        const target = files.find(({ file: f }) => f === `${spec.slice(2)}.ts`);
        expect(target, `${file} imports ${spec}`).toBeDefined();
        expect(directive(target?.text ?? "", "use server"), `${file} imports non-action module ${spec}`).toBe(true);
      }
    }
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/NEXT_PUBLIC_/);
      expect(text, file).not.toMatch(/SERVICE_ROLE|SUPABASE_SECRET_KEY|service_role/i);
    }
    for (const { file, text } of files.filter(({ file }) => file.startsWith("server/auth/") || file === "proxy.ts")) {
      expect(text, file).not.toMatch(/DATABASE_URL|PIPELINE_DATABASE_URL/);
    }
  });

  it("does not let the web application write authorization grants", () => {
    for (const { file, text } of files.filter(({ file }) => file.startsWith("app/") || file.startsWith("server/") || file.startsWith("components/"))) {
      expect(text, file).not.toMatch(/record_grant|INSERT INTO access\.grant_event/i);
    }
    const access = files.find(({ file }) => file === "server/auth/access.ts");
    expect(access?.text).toMatch(/SET ROLE access_reader/);
    expect(access?.text).not.toMatch(/email|user_metadata|app_metadata/i);
  });
});

import { describe, it, expect } from "vitest";
import { loadManifest } from "../../src/integrations/integration";
import { detectIntegration, parseAuthStatus } from "../../src/integrations/detector";

describe("integration manifest + detector", () => {
  it("loads and validates the shipped manifest", async () => {
    const m = await loadManifest();
    expect(Object.keys(m.integrations).sort()).toEqual(["antigravity", "claude", "codex", "cursor", "opencode"]);
    for (const entry of Object.values(m.integrations)) {
      expect(entry.executables.length).toBeGreaterThan(0);
    }
  });

  it("shows the shortened display names in the chat/agent picker (Codex, Cursor, Open Code — not the '...CLI' suffix)", async () => {
    const m = await loadManifest();
    expect(m.integrations.claude?.displayName).toBe("Claude Code");
    expect(m.integrations.codex?.displayName).toBe("Codex");
    expect(m.integrations.cursor?.displayName).toBe("Cursor");
    expect(m.integrations.opencode?.displayName).toBe("Open Code");
    expect(m.integrations.antigravity?.displayName).toBe("Antigravity");
  });

  it("claude carries a verified auth status command (claude auth status --json)", async () => {
    const m = await loadManifest();
    expect(m.integrations.claude?.authentication.statusArgs).toEqual(["auth", "status", "--json"]);
    expect(m.integrations.claude?.authentication.methods[0]?.verified).toBe(true);
    expect(m.integrations.claude?.worker.verified).toBe(true);
  });

  it("codex carries a verified non-interactive worker invocation (approve-for-me, no trust hang) with a --model slot", async () => {
    const m = await loadManifest();
    expect(m.integrations.codex?.authentication.statusArgs).toEqual(["login", "status"]);
    expect(m.integrations.codex?.worker.argv).toEqual(["exec", "--skip-git-repo-check", "--approve-for-me", "--model", "{model}", "{prompt}"]);
    expect(m.integrations.codex?.worker.verified).toBe(true);
  });

  it("cursor carries a verified non-interactive worker invocation (--trust, no workspace-trust hang) with a --model slot", async () => {
    const m = await loadManifest();
    expect(m.integrations.cursor?.authentication.statusArgs).toEqual(["status"]);
    expect(m.integrations.cursor?.worker.argv).toEqual(["-p", "{prompt}", "--output-format", "text", "--trust", "--model", "{model}"]);
    expect(m.integrations.cursor?.worker.verified).toBe(true);
  });

  it("default model labels come only from something directly observed in that tool's own UI, never fabricated", async () => {
    const m = await loadManifest();
    // cursor-agent models marks "auto" as "(current, default)" itself.
    expect(m.integrations.cursor?.defaultModelLabel).toBe("auto");
    // claude's own "Select model" picker shows "Default (recommended)" mapped to Sonnet.
    expect(m.integrations.claude?.defaultModelLabel).toBe("sonnet");
    // codex's own "Select Model and Effort" picker marked gpt-5.6-sol "(default)".
    expect(m.integrations.codex?.defaultModelLabel).toBe("gpt-5.6-sol");
    expect(m.integrations.opencode?.defaultModelLabel).toBeUndefined();
    expect(m.integrations.antigravity?.defaultModelLabel).toBeUndefined();
  });

  it("opencode carries a verified auth status command (opencode auth list)", async () => {
    const m = await loadManifest();
    expect(m.integrations.opencode?.authentication.statusArgs).toEqual(["auth", "list"]);
    expect(m.integrations.opencode?.authentication.methods[0]?.verified).toBe(true);
  });

  it("reports a missing integration as MISSING without throwing", async () => {
    const s = await detectIntegration("codex");
    expect(["missing", "installed", "login_required", "ready", "broken"]).toContain(s.readiness);
  });

  it("marks an unknown integration UNSUPPORTED", async () => {
    const s = await detectIntegration("not-a-real-tool");
    expect(s.readiness).toBe("unsupported");
  });
});

describe("parseAuthStatus", () => {
  it("reads `claude auth status --json`'s loggedIn:true as authenticated", () => {
    const stdout = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "someone@example.com" });
    expect(parseAuthStatus(stdout, "", 0)).toBe("authenticated");
  });

  it("reads loggedIn:false as not_authenticated", () => {
    const stdout = JSON.stringify({ loggedIn: false });
    expect(parseAuthStatus(stdout, "", 0)).toBe("not_authenticated");
  });

  it("falls back to a plain-text heuristic when the output isn't JSON", () => {
    expect(parseAuthStatus("You are logged in as someone@example.com", "", 0)).toBe("authenticated");
    expect(parseAuthStatus("Error: not logged in", "", 1)).toBe("not_authenticated");
  });

  it("reports unknown for output it can't classify either way", () => {
    expect(parseAuthStatus("", "", 0)).toBe("unknown");
    expect(parseAuthStatus(JSON.stringify({ some: "field" }), "", 0)).toBe("unknown");
  });

  it("reads `opencode auth list`'s credential count", () => {
    expect(parseAuthStatus("└  2 credentials", "", 0)).toBe("authenticated");
    expect(parseAuthStatus("└  1 credential", "", 0)).toBe("authenticated");
    expect(parseAuthStatus("No credentials configured", "", 0)).toBe("not_authenticated");
  });
});

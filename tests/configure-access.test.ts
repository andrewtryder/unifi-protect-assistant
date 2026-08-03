import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  API_BASE,
  DASHBOARD_APP_NAME,
  DASHBOARD_POLICY_NAME,
  WEBHOOK_APP_NAME,
  WEBHOOK_POLICY_NAME,
  SESSION,
  WORKER_SCRIPT_NAME,
  parseArgs,
  loadConfigFromEnv,
  buildDashboardPolicyInclude,
  buildDashboardAppBody,
  buildWebhookAppBody,
  assertPolicyExactEmails,
  assertWebhookPathExact,
  extractEmailsFromInclude,
  policyHasEmailDomain,
  policyHasEveryone,
  findDashboardApp,
  findWebhookApp,
  dashboardPolicyHasUnsafeRules,
  dashboardPolicyNeedsUpdate,
  emailsEqual,
  redactSensitive,
  createSafeLogger,
  resolveInstantAuthOptions,
  configureAccess,
  createCfClient,
  ConfigureAccessError,
  CloudflareApiError,
} from "../scripts/configure-cloudflare-access.mjs";

const ACCOUNT = "acct_test";
const TOKEN = "cf_test_token_secret_value";
const WORKER_ID = "06ad1013db124c11b1765e7bddc43ddf";
const HOST = "unifi-protect-assistant.mrcoffee.workers.dev";
const TEAM = "mrcoffee.cloudflareaccess.com";
const AUD = "aud_dashboard_abc123";

type Store = {
  apps: any[];
  policies: Record<string, any[]>;
  scripts: any[];
  org: any;
  idps?: any[];
};

function ok(result: unknown, result_info?: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        success: true,
        result,
        result_info: result_info ?? { page: 1, per_page: 100, total_pages: 1 },
      });
    },
  };
}

function err(status: number, message: string) {
  return {
    ok: false,
    status,
    async text() {
      return JSON.stringify({
        success: false,
        errors: [{ message }],
      });
    },
  };
}

function createMockFetch(store: Store) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    const u = String(url);
    const base = `${API_BASE}/accounts/${ACCOUNT}`;

    if (u.startsWith(`${base}/access/organizations`)) {
      return ok(store.org);
    }
    if (u.includes("/access/identity_providers")) {
      return ok(store.idps ?? [{ id: "idp_cf", type: "cloudflare", name: "" }]);
    }
    if (u.includes("/workers/scripts")) {
      return ok(store.scripts);
    }
    if (u.match(/\/access\/apps\/[^/]+\/policies\/[^/]+$/) && method === "PUT") {
      const m = u.match(/\/access\/apps\/([^/]+)\/policies\/([^/]+)/);
      const appId = m![1];
      const policyId = m![2];
      const body = JSON.parse(String(init?.body || "{}"));
      const list = store.policies[appId] || [];
      const idx = list.findIndex((p) => p.id === policyId);
      if (idx >= 0) list[idx] = { ...list[idx], ...body };
      else list.push({ id: policyId, ...body });
      store.policies[appId] = list;
      return ok(list.find((p) => p.id === policyId));
    }
    if (u.match(/\/access\/apps\/[^/]+\/policies/) && method === "POST") {
      const appId = u.match(/\/access\/apps\/([^/]+)\/policies/)![1];
      const body = JSON.parse(String(init?.body || "{}"));
      const policy = { id: `pol_${Math.random().toString(16).slice(2)}`, ...body };
      store.policies[appId] = [...(store.policies[appId] || []), policy];
      return ok(policy);
    }
    if (u.match(/\/access\/apps\/[^/]+\/policies/) && method === "GET") {
      const appId = u.match(/\/access\/apps\/([^/]+)\/policies/)![1];
      return ok(store.policies[appId] || []);
    }
    if (u.match(/\/access\/apps\/[^/?]+$/) && method === "GET") {
      const id = u.split("/access/apps/")[1].split("?")[0];
      const app = store.apps.find((a) => a.id === id);
      return app ? ok(app) : err(404, "not found");
    }
    if (u.match(/\/access\/apps\/[^/?]+$/) && method === "PUT") {
      const id = u.split("/access/apps/")[1].split("?")[0];
      const body = JSON.parse(String(init?.body || "{}"));
      const idx = store.apps.findIndex((a) => a.id === id);
      const prev = store.apps[idx];
      const next = { ...prev, ...body, id, aud: prev?.aud || AUD };
      if (Array.isArray(body.policies)) {
        store.policies[id] = body.policies.map((p: any, i: number) => ({
          id: p.id || `pol_inline_${i}`,
          ...p,
        }));
      }
      store.apps[idx] = next;
      return ok(next);
    }
    if (u.startsWith(`${base}/access/apps`) && method === "GET") {
      return ok(store.apps);
    }
    if (u.startsWith(`${base}/access/apps`) && method === "POST") {
      const body = JSON.parse(String(init?.body || "{}"));
      const id = `app_${Math.random().toString(16).slice(2)}`;
      const app = {
        ...body,
        id,
        aud: body.name === DASHBOARD_APP_NAME ? AUD : `aud_other_${id}`,
      };
      store.apps.push(app);
      if (Array.isArray(body.policies)) {
        store.policies[id] = body.policies.map((p: any, i: number) => ({
          id: `pol_${i}_${id}`,
          ...p,
        }));
      }
      return ok(app);
    }
    return err(404, `unhandled ${method} ${u}`);
  });
}

function baseEnv(emails: string) {
  return {
    CLOUDFLARE_API_TOKEN: TOKEN,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    ALLOWED_EMAILS: emails,
    WORKER_HOSTNAME: HOST,
  };
}

function emptyStore(): Store {
  return {
    apps: [],
    policies: {},
    scripts: [{ id: WORKER_SCRIPT_NAME, tag: WORKER_ID }],
    org: { auth_domain: TEAM },
    idps: [{ id: "idp_cf", type: "cloudflare", name: "" }],
  };
}

describe("parseArgs", () => {
  it("parses dry-run", () => {
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
    expect(parseArgs([]).dryRun).toBe(false);
  });

  it("rejects unknown args", () => {
    expect(() => parseArgs(["--force"])).toThrow(/Unknown argument/);
  });
});

describe("loadConfigFromEnv / ALLOWED_EMAILS", () => {
  it("rejects empty ALLOWED_EMAILS", () => {
    expect(() =>
      loadConfigFromEnv({
        CLOUDFLARE_API_TOKEN: TOKEN,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        ALLOWED_EMAILS: "",
      })
    ).toThrow(/ALLOWED_EMAILS/);
  });

  it("rejects malformed emails", () => {
    expect(() =>
      loadConfigFromEnv({
        CLOUDFLARE_API_TOKEN: TOKEN,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        ALLOWED_EMAILS: "not-an-email",
      })
    ).toThrow(/malformed|exact email/i);
  });

  it("rejects wildcards / domains", () => {
    expect(() =>
      loadConfigFromEnv({
        CLOUDFLARE_API_TOKEN: TOKEN,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        ALLOWED_EMAILS: "*@example.com",
      })
    ).toThrow(/wildcard|exact/i);
  });

  it("normalizes and sorts emails", () => {
    const cfg = loadConfigFromEnv(baseEnv("Bob@Example.com, alice@test.com"));
    expect(cfg.emails).toEqual(["alice@test.com", "bob@example.com"]);
    expect(cfg.allowlistCount).toBe(2);
    expect(cfg.webhookUri).toBe(`${HOST}/unifi`);
  });
});

describe("policy helpers", () => {
  it("buildDashboardPolicyInclude", () => {
    expect(buildDashboardPolicyInclude(["a@b.com", "c@d.com"])).toEqual([
      { email: { email: "a@b.com" } },
      { email: { email: "c@d.com" } },
    ]);
  });

  it("assertPolicyExactEmails accepts exact set", () => {
    const policy = {
      name: DASHBOARD_POLICY_NAME,
      decision: "allow",
      include: buildDashboardPolicyInclude(["a@b.com"]),
    };
    expect(assertPolicyExactEmails(policy, ["a@b.com"])).toBe(true);
  });

  it("assertPolicyExactEmails rejects email_domain", () => {
    expect(() =>
      assertPolicyExactEmails(
        {
          decision: "allow",
          include: [{ email_domain: { domain: "example.com" } }],
        },
        ["a@example.com"]
      )
    ).toThrow(/email_domain/);
  });

  it("assertPolicyExactEmails rejects everyone", () => {
    expect(() =>
      assertPolicyExactEmails({ decision: "allow", include: [{ everyone: {} }] }, ["a@b.com"])
    ).toThrow(/everyone/);
  });

  it("assertPolicyExactEmails detects drift", () => {
    expect(() =>
      assertPolicyExactEmails(
        {
          decision: "allow",
          include: buildDashboardPolicyInclude(["old@x.com", "keep@x.com"]),
        },
        ["keep@x.com", "new@x.com"]
      )
    ).toThrow(/drift/);
  });

  it("detects email_domain / everyone helpers", () => {
    expect(policyHasEmailDomain([{ email_domain: { domain: "x.com" } }])).toBe(true);
    expect(policyHasEveryone([{ everyone: {} }])).toBe(true);
    expect(
      dashboardPolicyHasUnsafeRules({
        decision: "allow",
        include: [{ email_domain: { domain: "x.com" } }],
      })
    ).toBe(true);
  });

  it("assertWebhookPathExact rejects overly broad paths", () => {
    expect(() => assertWebhookPathExact(`${HOST}/*`, HOST)).toThrow(/exactly|broad|unifi/i);
    expect(() => assertWebhookPathExact(HOST, HOST)).toThrow(/exactly|broad|unifi/i);
    expect(assertWebhookPathExact(`${HOST}/unifi`, HOST)).toBe(true);
  });

  it("emailsEqual", () => {
    expect(emailsEqual(["B@x.com", "a@x.com"], ["a@x.com", "b@x.com"])).toBe(true);
    expect(emailsEqual(["a@x.com"], ["a@x.com", "b@x.com"])).toBe(false);
  });
});

describe("findDashboardApp / findWebhookApp", () => {
  it("refuses same name different destination", () => {
    expect(() =>
      findDashboardApp(
        [
          {
            name: DASHBOARD_APP_NAME,
            destinations: [{ type: "worker", worker_id: "other" }],
          },
        ],
        WORKER_ID
      )
    ).toThrow(/destination does not match/);
  });

  it("finds matching worker destination", () => {
    const app = {
      name: DASHBOARD_APP_NAME,
      destinations: [{ type: "worker", worker_id: WORKER_ID }],
    };
    expect(findDashboardApp([app], WORKER_ID)).toBe(app);
  });

  it("refuses webhook app with wrong path", () => {
    expect(() =>
      findWebhookApp(
        [
          {
            name: WEBHOOK_APP_NAME,
            destinations: [{ type: "public", uri: `${HOST}/api` }],
          },
        ],
        `${HOST}/unifi`
      )
    ).toThrow(/destination path/);
  });
});

describe("redaction", () => {
  it("never leaves token or emails in logged strings", () => {
    const lines: string[] = [];
    const log = createSafeLogger((m) => lines.push(m), {
      token: TOKEN,
      emails: ["secret.user@example.com"],
    });
    log(`token=${TOKEN} email=secret.user@example.com Bearer ${TOKEN}`);
    const joined = lines.join("\n");
    expect(joined).not.toContain(TOKEN);
    expect(joined).not.toContain("secret.user@example.com");
    expect(joined).toContain("[REDACTED_TOKEN]");
    expect(joined).toContain("[REDACTED_EMAIL]");
  });

  it("redactSensitive standalone", () => {
    const out = redactSensitive(`Authorization: Bearer ${TOKEN} a@b.com`, {
      token: TOKEN,
      emails: ["a@b.com"],
    });
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain("a@b.com");
  });
});

describe("configureAccess with mocked fetch", () => {
  let store: Store;
  let fetchImpl: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    store = emptyStore();
    fetchImpl = createMockFetch(store);
  });

  async function run(emails: string, dryRun = false) {
    const config = loadConfigFromEnv(baseEnv(emails));
    const lines: string[] = [];
    const client = createCfClient({
      token: config.token,
      accountId: config.accountId,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await configureAccess({
      config,
      dryRun,
      client,
      log: (m) => lines.push(m),
    });
    return { result, lines, config };
  }

  it("creates with one email", async () => {
    const { result, lines } = await run("only@example.com");
    expect(result.mutated).toBe(true);
    expect(result.dashboardAud).toBe(AUD);
    expect(result.teamDomain).toBe(TEAM);
    expect(store.apps).toHaveLength(3);
    const dash = store.apps.find((a) => a.name === DASHBOARD_APP_NAME);
    expect(dash.destinations[0].worker_id).toBe(WORKER_ID);
    const pols = store.policies[dash.id];
    expect(extractEmailsFromInclude(pols[0].include)).toEqual(["only@example.com"]);
    expect(lines.some((l) => l.includes("allowlist_count=1"))).toBe(true);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("only@example.com");
  });

  it("creates with multiple emails", async () => {
    const { result } = await run("z@ex.com,a@ex.com,b@ex.com");
    expect(result.allowlistCount).toBe(3);
    const dash = store.apps.find((a) => a.name === DASHBOARD_APP_NAME);
    const emails = extractEmailsFromInclude(store.policies[dash.id][0].include);
    expect(emails).toEqual(["a@ex.com", "b@ex.com", "z@ex.com"]);
  });

  it("second-run is no-op", async () => {
    await run("a@ex.com");
    const fetchCountAfterCreate = fetchImpl.mock.calls.length;
    const { result, lines } = await run("a@ex.com");
    expect(result.noop).toBe(true);
    expect(result.mutated).toBe(false);
    expect(lines.some((l) => /no changes needed|noop/i.test(l))).toBe(true);
    // Should not POST/PUT apps on second run (only reads)
    const mutating = fetchImpl.mock.calls
      .slice(fetchCountAfterCreate)
      .filter((c) =>
        ["POST", "PUT", "PATCH", "DELETE"].includes(String(c[1]?.method || "GET").toUpperCase())
      );
    expect(mutating).toHaveLength(0);
  });

  it("updates existing matching policy (allowlist drift / stale removal)", async () => {
    const dashId = "dash_existing";
    store.apps.push({
      id: dashId,
      name: DASHBOARD_APP_NAME,
      type: "self_hosted",
      session_duration: SESSION,
      auto_redirect_to_identity: true,
      allowed_idps: ["idp_cf"],
      app_launcher_visible: false,
      aud: AUD,
      destinations: [{ type: "worker", worker_id: WORKER_ID }],
    });
    store.policies[dashId] = [
      {
        id: "pol_dash",
        name: DASHBOARD_POLICY_NAME,
        decision: "allow",
        include: buildDashboardPolicyInclude(["stale@ex.com", "keep@ex.com"]),
      },
    ];
    store.apps.push({
      id: "wh_existing",
      name: WEBHOOK_APP_NAME,
      type: "self_hosted",
      session_duration: SESSION,
      app_launcher_visible: false,
      destinations: [{ type: "public", uri: `${HOST}/unifi` }],
    });
    store.policies.wh_existing = [
      {
        id: "pol_wh",
        name: WEBHOOK_POLICY_NAME,
        decision: "bypass",
        include: [{ everyone: {} }],
      },
    ];

    const { result, lines } = await run("keep@ex.com,new@ex.com");
    expect(result.mutated).toBe(true);
    expect(lines.some((l) => /drift|update dashboard policy/i.test(l))).toBe(true);
    const emails = extractEmailsFromInclude(store.policies[dashId][0].include);
    expect(emails).toEqual(["keep@ex.com", "new@ex.com"]);
    expect(emails).not.toContain("stale@ex.com");
  });

  it("refuses unrelated app same name different dest", async () => {
    store.apps.push({
      id: "wrong",
      name: DASHBOARD_APP_NAME,
      destinations: [{ type: "worker", worker_id: "not-our-worker" }],
    });
    await expect(run("a@ex.com")).rejects.toThrow(/destination does not match/);
  });

  it("corrects email-domain rule on managed app", async () => {
    const dashId = "dash_domain";
    store.apps.push({
      id: dashId,
      name: DASHBOARD_APP_NAME,
      type: "self_hosted",
      session_duration: SESSION,
      auto_redirect_to_identity: true,
      allowed_idps: ["idp_cf"],
      app_launcher_visible: false,
      aud: AUD,
      destinations: [{ type: "worker", worker_id: WORKER_ID }],
    });
    store.policies[dashId] = [
      {
        id: "pol_bad",
        name: DASHBOARD_POLICY_NAME,
        decision: "allow",
        include: [{ email_domain: { domain: "example.com" } }],
      },
    ];
    store.apps.push({
      id: "wh",
      name: WEBHOOK_APP_NAME,
      type: "self_hosted",
      session_duration: SESSION,
      app_launcher_visible: false,
      destinations: [{ type: "public", uri: `${HOST}/unifi` }],
    });
    store.policies.wh = [
      {
        id: "pol_wh",
        name: WEBHOOK_POLICY_NAME,
        decision: "bypass",
        include: [{ everyone: {} }],
      },
    ];

    expect(dashboardPolicyNeedsUpdate(store.policies[dashId][0], ["a@example.com"])).toBe(true);

    const { result, lines } = await run("a@example.com");
    expect(result.mutated).toBe(true);
    expect(lines.some((l) => /email_domain|correcting/i.test(l))).toBe(true);
    assertPolicyExactEmails(store.policies[dashId][0], ["a@example.com"]);
  });

  it("detects overly broad bypass path", async () => {
    store.apps.push({
      id: "dash_ok",
      name: DASHBOARD_APP_NAME,
      type: "self_hosted",
      session_duration: SESSION,
      auto_redirect_to_identity: true,
      allowed_idps: ["idp_cf"],
      app_launcher_visible: false,
      aud: AUD,
      destinations: [{ type: "worker", worker_id: WORKER_ID }],
    });
    store.policies.dash_ok = [
      {
        id: "p1",
        name: DASHBOARD_POLICY_NAME,
        decision: "allow",
        include: buildDashboardPolicyInclude(["a@ex.com"]),
      },
    ];
    // Name matches desired webhook name but wrong path → findWebhookApp refuses
    store.apps.push({
      id: "wh_broad",
      name: WEBHOOK_APP_NAME,
      type: "self_hosted",
      session_duration: SESSION,
      app_launcher_visible: false,
      destinations: [{ type: "public", uri: `${HOST}/*` }],
    });

    await expect(run("a@ex.com")).rejects.toThrow(/destination path|exactly|broad|unifi/i);
  });

  it("dry-run prints plans without mutating", async () => {
    const { result, lines } = await run("a@ex.com", true);
    expect(result.dryRun).toBe(true);
    expect(result.mutated).toBe(false);
    expect(store.apps).toHaveLength(0);
    expect(lines.some((l) => /plan: create dashboard/i.test(l))).toBe(true);
    expect(lines.some((l) => /plan: create webhook/i.test(l))).toBe(true);
  });

  it("surfaces 403 permission errors clearly", async () => {
    const denied = vi.fn(async () => err(403, "Authentication error"));
    const config = loadConfigFromEnv(baseEnv("a@ex.com"));
    const client = createCfClient({
      token: config.token,
      accountId: config.accountId,
      fetchImpl: denied as unknown as typeof fetch,
    });
    await expect(configureAccess({ config, client, log: () => {} })).rejects.toBeInstanceOf(
      CloudflareApiError
    );
    await expect(configureAccess({ config, client, log: () => {} })).rejects.toThrow(
      /403|permission/i
    );
  });
});

describe("resolveInstantAuthOptions", () => {
  it("prefers Cloudflare IdP when present among multiple IdPs", () => {
    expect(
      resolveInstantAuthOptions([
        { id: "g", type: "google" },
        { id: "otp", type: "onetimepin" },
        { id: "cf", type: "cloudflare" },
      ])
    ).toEqual({ auto_redirect_to_identity: true, allowed_idps: ["cf"] });
  });

  it("disables instant auth when multiple non-Cloudflare IdPs exist", () => {
    expect(
      resolveInstantAuthOptions([
        { id: "g", type: "google" },
        { id: "otp", type: "onetimepin" },
      ])
    ).toEqual({ auto_redirect_to_identity: false });
  });
});

describe("build bodies", () => {
  it("dashboard body shape with instant auth IdP", () => {
    const body = buildDashboardAppBody(WORKER_ID, ["a@b.com"], {
      auto_redirect_to_identity: true,
      allowed_idps: ["idp_cf"],
    });
    expect(body).toMatchObject({
      name: DASHBOARD_APP_NAME,
      type: "self_hosted",
      session_duration: SESSION,
      auto_redirect_to_identity: true,
      allowed_idps: ["idp_cf"],
      app_launcher_visible: false,
      destinations: [{ type: "worker", worker_id: WORKER_ID }],
    });
    expect(body.policies[0].name).toBe(DASHBOARD_POLICY_NAME);
  });

  it("dashboard body disables instant auth without a single IdP", () => {
    const body = buildDashboardAppBody(WORKER_ID, ["a@b.com"]);
    expect(body.auto_redirect_to_identity).toBe(false);
    expect(body.allowed_idps).toBeUndefined();
  });

  it("webhook body shape", () => {
    const body = buildWebhookAppBody(`${HOST}/unifi`);
    expect(body.name).toBe(WEBHOOK_APP_NAME);
    expect(body.destinations[0]).toEqual({
      type: "public",
      uri: `${HOST}/unifi`,
    });
    expect(body.policies[0].decision).toBe("bypass");
  });
});

describe("ConfigureAccessError codes", () => {
  it("is constructible", () => {
    const e = new ConfigureAccessError("x", "Y");
    expect(e.code).toBe("Y");
  });
});

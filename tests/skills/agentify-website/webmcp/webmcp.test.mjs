// Tests for the optional WebMCP template (templates/webmcp.js), with a stand-in
// modelContext and a stand-in site-actions.js.
//   node --test tests/skills/agentify-website/webmcp/webmcp.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const SKILL = fileURLToPath(new URL("../../../../skills/agentify-website/", import.meta.url));

// A site folder with the template, the runtime and a small actions module.
const site = mkdtempSync(join(tmpdir(), "webmcp-site-"));
cpSync(join(SKILL, "templates", "webmcp.js"), join(site, "webmcp.js"));
mkdirSync(join(site, "runtime"));
cpSync(join(SKILL, "runtime"), join(site, "runtime"), { recursive: true });
writeFileSync(join(site, "site-actions.js"), `
export const calls = [];
export function registerActions(actions) {
  actions.register({ name: "get_menu", description: "Read the menu.", effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => ({ items: ["margherita"] }) });
  actions.register({ name: "add_to_cart", description: "Add a pizza.", effect: "write",
    inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", enum: ["margherita"] } } },
    execute: (a) => { calls.push(["add", a]); return { ok: true, cart: [a.id] }; } });
  actions.register({ name: "place_order", description: "Place the order.", effect: "irreversible",
    inputSchema: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string", minLength: 1 } } },
    execute: (a) => { calls.push(["order", a]); return { ok: true, order: "A1" }; } });
  actions.register({ name: "partner_read", description: "Bridge only.", effect: "read", availability: "bridge",
    inputSchema: { type: "object" }, execute: () => ({}) });
}
`);
const { SiteWebMCP } = await import(pathToFileURL(join(site, "webmcp.js")).href);
const { calls } = await import(pathToFileURL(join(site, "site-actions.js")).href);

/** A stand-in for the browser's modelContext. */
class FakeModelContext {
  constructor() {
    this.tools = new Map();
  }
  registerTool(tool) {
    this.tools.set(tool.name, tool);
  }
}

/** Replace Node's read-only navigator with a stand-in. */
const setNavigator = (value) => Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });

let mc;
beforeEach(() => {
  mc = new FakeModelContext();
  setNavigator({ modelContext: mc });
  globalThis.location = { origin: "https://pizza.example" };
  calls.length = 0;
});

const text = (r) => r.content[0].text;

test("without modelContext nothing is registered", () => {
  setNavigator({});
  assert.deepEqual(SiteWebMCP.register(), []);
});

test("reads and writes are offered; bridge-only and unconfirmable actions are not", () => {
  assert.deepEqual(SiteWebMCP.register(), ["get_menu", "add_to_cart"]);
  assert.equal(mc.tools.get("get_menu").annotations.readOnlyHint, true);
  assert.equal(mc.tools.get("add_to_cart").annotations.readOnlyHint, undefined);
});

test("a read runs and returns JSON text", async () => {
  SiteWebMCP.register();
  const r = await mc.tools.get("get_menu").execute({});
  assert.deepEqual(JSON.parse(text(r)), { items: ["margherita"] });
  assert.equal(r.isError, undefined);
});

test("arguments are validated before execute runs", async () => {
  SiteWebMCP.register();
  const r = await mc.tools.get("add_to_cart").execute({ id: "pineapple" });
  assert.equal(r.isError, true);
  assert.match(text(r), /^Nothing ran/);
  assert.equal(calls.length, 0);
});

test("an irreversible action runs only after the page's own confirmation", async () => {
  const asked = [];
  SiteWebMCP.register({ confirm: async (items) => (asked.push(items), false) });
  const tool = mc.tools.get("place_order");
  assert.equal(tool.annotations.consequentialHint, true);
  let r = await tool.execute({ name: "Sam" });
  assert.equal(r.isError, true);
  assert.match(text(r), /declined/);
  assert.equal(calls.length, 0);
  assert.equal(asked[0][0].origin, "https://pizza.example");
  SiteWebMCP.register({ confirm: async () => true });
  r = await mc.tools.get("place_order").execute({ name: "Sam" });
  assert.deepEqual(JSON.parse(text(r)), { ok: true, order: "A1" });
  assert.deepEqual(calls, [["order", { name: "Sam" }]]);
});

test("a site refusal is a tool error, and a confirm that throws runs nothing", async () => {
  SiteWebMCP.register({ confirm: async () => { throw new Error("The cart changed."); } });
  const r = await mc.tools.get("place_order").execute({ name: "Sam" });
  assert.equal(r.isError, true);
  assert.match(text(r), /The cart changed/);
  assert.equal(calls.length, 0);
});

test("provideContext is used when registerTool is missing", () => {
  let provided = null;
  setNavigator({ modelContext: { provideContext: (ctx) => (provided = ctx) } });
  assert.deepEqual(SiteWebMCP.register(), ["get_menu", "add_to_cart"]);
  assert.equal(provided.tools.length, 2);
});

// Checks that the agentified site's network, manifest and actions work together.
// Run: node --test "<site>/tests/*.test.mjs"   (Node 22 does not accept a bare folder.)
// These tests use the real runtime and the real page code, with a scripted model.
// They do not call an LLM provider.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";
import { buildToolTable, dispatchToolCall, runAgent } from "../runtime/runner.js";
import { TraceBus } from "../runtime/trace.js";
import { StubDocument } from "./stub_document.mjs";
import { ScriptedModel } from "./scripted_model.mjs";

// TODO: set these for the site.
const NETWORK_NAME = "<network_name>";
const READ_ACTION = "get_site_state";
const IRREVERSIBLE_ACTION = "submit_order";
const BASE = "http://localhost:8080";

// Page scripts touch the DOM when they load, so give them a stand-in first.
// It knows the ids in index.html, so a mistyped id fails instead of passing silently.
globalThis.document = StubDocument.fromHtml(await readFile(new URL("../index.html", import.meta.url), "utf8"));
const { registerActions } = await import("../site-actions.js");

/**
 * Integration checks for an agentified website.
 *
 * Each test builds the runtime objects the browser would build and drives them with a
 * ScriptedModel. Add site-specific tests below for every write and irreversible action.
 */
class AgentifiedSiteTest {
  /**
   * Read the published network and manifest.
   *
   * :return: An object with config, manifest and network.
   */
  static async load() {
    const config = JSON.parse(await readFile(new URL(`../${NETWORK_NAME}.network.json`, import.meta.url), "utf8"));
    const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
    return {
      config: config,
      manifest: manifest,
      network: new AgentNetwork(config, NETWORK_NAME),
    };
  }

  /**
   * Create a registry with the site's actions registered.
   *
   * :return: The action registry.
   */
  static registry() {
    const registry = new ActionRegistry();
    const scope = {
      base: BASE,
      network: NETWORK_NAME,
    };
    registerActions({
      register: registry.register.bind(registry, scope),
    });
    return registry;
  }

  /**
   * Build the runner context the engine would pass to runAgent.
   *
   * :param loaded: The result of load().
   * :param registry: The action registry.
   * :param model: The scripted model.
   * :param confirm: The confirmation callback, or undefined to leave it out.
   * :return: The runner context.
   */
  static context(loaded, registry, model, confirm) {
    return {
      network: loaded.network,
      manifest: loaded.manifest,
      actions: registry,
      baseOrigin: BASE,
      displayOrigin: new URL(BASE).host,
      trace: new TraceBus(),
      isTop: true,
      frontMan: loaded.network.findFrontMan(),
      history: [],
      llm: model,
      confirmWebsiteActions: confirm,
    };
  }

  /**
   * Run the read action directly and return its result.
   *
   * :param registry: The action registry.
   * :return: The page state.
   */
  static async readState(registry) {
    const plan = registry.prepare({
      kind: "action",
      action: AgentifiedSiteTest.ref(registry, READ_ACTION),
      arguments: {},
    });
    const receipts = await registry.execute(plan, AgentifiedSiteTest.approve, "test-read");
    return receipts[0].result;
  }

  /**
   * Find an action's reference by name.
   *
   * :param registry: The action registry.
   * :param name: The action name.
   * :return: The action reference.
   */
  static ref(registry, name) {
    for (const entry of registry.catalog({ base: BASE, network: NETWORK_NAME })) {
      if (entry.name === name) {
        return entry.ref;
      }
    }
    throw new Error(`Action ${name} is not registered.`);
  }

  /**
   * Approve every confirmation.
   *
   * :return: True.
   */
  static async approve() {
    return true;
  }

  /**
   * Decline every confirmation, as a visitor pressing Cancel would.
   *
   * :return: False.
   */
  static async decline() {
    return false;
  }

  /**
   * Put the page in a state where the irreversible action would succeed if approved.
   *
   * Without this, a decline test on an empty cart proves nothing: the site would refuse anyway.
   *
   * :param registry: The action registry.
   * :return: A promise that resolves when the state is ready.
   */
  static async arrangeIrreversibleState(registry) {
    // TODO: run the write actions needed first, for example add one item to the cart.
    const plan = registry.prepare({
      kind: "action",
      action: AgentifiedSiteTest.ref(registry, "add_item"),
      arguments: {
        id: "TODO-real-id",
        quantity: 1,
      },
    });
    await registry.execute(plan, AgentifiedSiteTest.approve, "test-arrange");
  }

  /**
   * Return valid arguments for the irreversible action, based on current state.
   *
   * :param state: The page state from the read action.
   * :return: The arguments.
   */
  static irreversibleArguments(state) {
    // TODO: build valid arguments for IRREVERSIBLE_ACTION from the state.
    return {
      customerName: "Test Visitor",
      expectedVersion: state.version,
    };
  }

  /**
   * The network passes runtime validation, has one front agent and no demo mode.
   */
  static async testNetworkIsValid() {
    const loaded = await AgentifiedSiteTest.load();
    assert.deepEqual(validateNetwork(loaded.network).errors, []);
    assert.equal(loaded.network.findFrontMan(), loaded.manifest.networks[0].front_man);
    assert.ok(!JSON.stringify(loaded.config).includes("make up a realistic response"));
  }

  /**
   * Every agentTools name is a registered, local-only action, so it becomes a tool.
   */
  static async testActionsMatchManifest() {
    const loaded = await AgentifiedSiteTest.load();
    const registry = AgentifiedSiteTest.registry();
    const registered = new Map();
    for (const entry of registry.catalog({ base: BASE, network: NETWORK_NAME })) {
      registered.set(entry.name, entry);
    }
    for (const name of loaded.manifest.actions.agentTools) {
      assert.ok(registered.has(name), `agentTools lists ${name}, but it is not registered.`);
      assert.equal(registered.get(name).availability, "local-only");
    }
  }

  /**
   * The front agent can call the read tool and gets a succeeded receipt back.
   */
  static async testReadActionRunsAsTool() {
    const loaded = await AgentifiedSiteTest.load();
    const registry = AgentifiedSiteTest.registry();
    const model = new ScriptedModel([
      {
        tool: `website_${READ_ACTION}`,
        arguments: {},
      },
      {
        text: "Here is what I found.",
      },
    ]);
    const ctx = AgentifiedSiteTest.context(loaded, registry, model, AgentifiedSiteTest.approve);
    const result = await runAgent(ctx, ctx.frontMan, "What can I get here?", null, []);
    assert.ok(model.toolNames(0).includes(`website_${READ_ACTION}`));
    assert.equal(model.toolResults(1)[0].status, "succeeded");
    assert.match(result.text, /found/);
  }

  /**
   * The irreversible tool is hidden without a confirmation handler, and declining changes nothing.
   */
  static async testIrreversibleActionNeedsConfirmation() {
    const loaded = await AgentifiedSiteTest.load();
    const registry = AgentifiedSiteTest.registry();
    const model = new ScriptedModel([]);
    const spec = loaded.network.getAgentSpec(loaded.network.findFrontMan());
    const unconfirmed = AgentifiedSiteTest.context(loaded, registry, model, undefined);
    const hidden = await buildToolTable(unconfirmed, spec, [], null);
    assert.ok(!hidden.toolByName.has(`website_${IRREVERSIBLE_ACTION}`));

    const declining = AgentifiedSiteTest.context(loaded, registry, model, AgentifiedSiteTest.decline);
    const table = await buildToolTable(declining, spec, [], null);
    const entry = table.toolByName.get(`website_${IRREVERSIBLE_ACTION}`);
    assert.ok(entry, `website_${IRREVERSIBLE_ACTION} should be offered when confirmation is available.`);
    await AgentifiedSiteTest.arrangeIrreversibleState(registry);
    const before = await AgentifiedSiteTest.readState(registry);
    const receipt = await dispatchToolCall(declining, entry, AgentifiedSiteTest.irreversibleArguments(before), null, []);
    assert.equal(receipt.status, "cancelled");
    assert.deepEqual(await AgentifiedSiteTest.readState(registry), before);
  }

  // TODO: add one test per write action (state and visible page change, bad IDs rejected),
  // one for the approved irreversible action from the same arranged state (receipt matches
  // the page's own form), one for a stale expectedVersion (result.ok false), and one per
  // refusal the site function returns. Trigger page buttons with element.dispatch("click").
}

test("network is valid and has no demo mode", AgentifiedSiteTest.testNetworkIsValid);
test("agentTools are registered local-only actions", AgentifiedSiteTest.testActionsMatchManifest);
test("front agent reads page state through a website tool", AgentifiedSiteTest.testReadActionRunsAsTool);
test("irreversible action needs confirmation and a decline changes nothing", AgentifiedSiteTest.testIrreversibleActionNeedsConfirmation);

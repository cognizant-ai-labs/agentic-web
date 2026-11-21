// Checks how the skill's runtime runs a partner network for a visitor: on the visitor's
// model, else on the calling site's front-agent model, and within the calling site's step
// limit. The calling site's own agents keep their models and limits. Also checks the
// publisher-funded router (spec §4): the site pays, so it takes no visitor key.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The sites, the router and the key are fakes behind a stub fetch. No model is called.
import assert from "node:assert/strict";
import test from "node:test";
import { Engine, isPublisherFundedRouter, selectPeerRouter, selectTopRouter } from "../../../../skills/agentify-website/runtime/engine.js";
import { FakeSites } from "./fake_sites.mjs";

/**
 * Runs one visitor turn through the Engine, on a caller site whose front agent calls a
 * partner network.
 *
 * Each test checks which models the agents asked the router for, or how many model calls
 * each agent made.
 */
class EngineModelTest {
  /**
   * The router a publisher-funded site pays for, and the router for visitors' own keys.
   */
  static FUNDED = "https://funded.example.workers.dev/v1";
  static BYOK = "https://api.otari.ai/api/v1";

  /**
   * A manifest whose default router is publisher-funded.
   *
   * :param changes: Fields to change in llm_router.
   * :return: The manifest.
   */
  static fundedManifest(changes = {}) {
    return {llm_router: {base_url: EngineModelTest.FUNDED, publisher_funded: true, mock: false,
      byok_router: EngineModelTest.BYOK, ...changes}};
  }

  /**
   * Run one visitor turn on the caller site.
   *
   * :param sites: The fake sites.
   * :param visitorModel: The model the visitor picked, or "" for none.
   * :return: The turn's result.
   */
  static async runTurn(sites, visitorModel) {
    sites.install();
    try {
      // With no consent hook, the engine allows the partner call, as in a headless page.
      const engine = new Engine({
        originUrl: FakeSites.CALLER,
        byokKey: FakeSites.KEY,
        modelOverride: visitorModel,
      });
      return await engine.runTurn(FakeSites.REQUEST);
    } finally {
      sites.restore();
    }
  }

  /**
   * Build sites where each side has a front agent and a helper with a model of its own.
   * The caller's front agent calls the partner, then its helper. The partner's front
   * agent calls its helper.
   *
   * :param callerSettings: The caller network's own fields.
   * :param frontSettings: The caller front agent's own fields.
   * :return: The fake sites.
   */
  static modelSites(callerSettings, frontSettings) {
    const caller = FakeSites.network(callerSettings, [
      FakeSites.agent("caller_front", [FakeSites.PARTNER_URL, "caller_helper"], frontSettings),
      FakeSites.agent("caller_helper", [], {llm_config: {model_name: "caller-helper-model"}}),
    ]);
    const partner = FakeSites.network({llm_config: {model_name: "partner-model"}}, [
      FakeSites.agent("partner_front", ["partner_helper"], {}),
      FakeSites.agent("partner_helper", [], {llm_config: {model_name: "partner-helper-model"}}),
    ]);
    return new FakeSites(caller, partner, {
      caller_front: [FakeSites.PARTNER_TOOL, "caller_helper"],
      partner_front: ["partner_helper"],
    });
  }

  /**
   * A model the visitor picked is used by every agent on both sites.
   */
  static async testVisitorModelForEveryAgent() {
    const sites = EngineModelTest.modelSites({llm_config: {model_name: "caller-model"}}, {});
    const result = await EngineModelTest.runTurn(sites, "visitor-model");
    assert.equal(result.text, "caller_front answer");
    for (const agent of ["caller_front", "caller_helper", "partner_front", "partner_helper"]) {
      assert.deepEqual(sites.models(agent), ["visitor-model"], `${agent} did not use the visitor's model.`);
    }
    assert.deepEqual(sites.unexpected, []);
  }

  /**
   * With no visitor model, the partner's agents use the caller's front-agent model, and
   * the caller's own agents keep theirs.
   */
  static async testPartnerUsesCallerModel() {
    const sites = EngineModelTest.modelSites({llm_config: {model_name: "caller-model"}}, {});
    const result = await EngineModelTest.runTurn(sites, "");
    assert.equal(result.text, "caller_front answer");
    assert.deepEqual(sites.models("caller_front"), ["caller-model"]);
    assert.deepEqual(sites.models("caller_helper"), ["caller-helper-model"]);
    assert.deepEqual(sites.models("partner_front"), ["caller-model"], "The partner did not use the caller's model.");
    assert.deepEqual(sites.models("partner_helper"), ["caller-model"], "The partner's helper did not use the caller's model.");
    assert.deepEqual(sites.unexpected, []);
  }

  /**
   * A model set only on the caller's front agent, not on its network, is the one the
   * partner gets.
   */
  static async testAgentLevelCallerModel() {
    const sites = EngineModelTest.modelSites({}, {llm_config: {model_name: "caller-front-model"}});
    const result = await EngineModelTest.runTurn(sites, "");
    assert.equal(result.text, "caller_front answer");
    assert.deepEqual(sites.models("caller_front"), ["caller-front-model"]);
    assert.deepEqual(sites.models("caller_helper"), ["caller-helper-model"]);
    assert.deepEqual(sites.models("partner_front"), ["caller-front-model"], "The partner did not use the caller's front-agent model.");
    assert.deepEqual(sites.models("partner_helper"), ["caller-front-model"], "The partner's helper did not use the caller's front-agent model.");
    assert.deepEqual(sites.unexpected, []);
  }

  /**
   * A partner that allows 40 steps, and whose model always calls a tool, stops at the
   * caller's 12. A lower limit of the partner's own still holds. The caller's own agents
   * keep their limits, even one above 12.
   */
  static async testPartnerStopsAtCallerSteps() {
    const caller = FakeSites.network({max_steps: 12}, [
      FakeSites.agent("caller_front", [FakeSites.PARTNER_URL, "caller_helper"], {}),
      FakeSites.agent("caller_helper", [], {max_steps: 20}),
    ]);
    const partner = FakeSites.network({max_steps: 40}, [
      FakeSites.agent("partner_front", ["partner_helper"], {}),
      FakeSites.agent("partner_helper", [], {max_steps: 3}),
    ]);
    const sites = new FakeSites(caller, partner, {
      caller_front: [FakeSites.PARTNER_TOOL, "caller_helper"],
      caller_helper: [FakeSites.FOREVER],
      partner_front: ["partner_helper", FakeSites.FOREVER],
      partner_helper: [FakeSites.FOREVER],
    });
    const result = await EngineModelTest.runTurn(sites, "visitor-model");
    assert.equal(result.text, "caller_front answer");
    assert.equal(sites.calls("partner_front"), 12, "The partner's front agent did not stop at the caller's step limit.");
    assert.equal(sites.calls("partner_helper"), 3, "The partner's own lower limit did not hold.");
    assert.equal(sites.calls("caller_helper"), 20, "The caller's helper did not keep its own limit.");
    assert.equal(sites.calls("caller_front"), 3);
    assert.deepEqual(sites.unexpected, []);
  }

  /**
   * A limit set on the caller's front agent itself, lower than the runner's default of
   * 12, is the one the partner gets.
   */
  static async testPartnerFollowsCallerFrontLimit() {
    const caller = FakeSites.network({}, [
      FakeSites.agent("caller_front", [FakeSites.PARTNER_URL], {max_steps: 5}),
    ]);
    const partner = FakeSites.network({max_steps: 40}, [
      FakeSites.agent("partner_front", [], {}),
    ]);
    const sites = new FakeSites(caller, partner, {
      caller_front: [FakeSites.PARTNER_TOOL],
      partner_front: [FakeSites.FOREVER],
    });
    const result = await EngineModelTest.runTurn(sites, "visitor-model");
    assert.equal(result.text, "caller_front answer");
    assert.equal(sites.calls("partner_front"), 5, "The partner did not stop at the caller front agent's limit.");
    assert.equal(sites.calls("caller_front"), 2);
    assert.deepEqual(sites.unexpected, []);
  }

  /**
   * With no key, the publisher-funded router is chosen and is not called a mock. A saved
   * override that is that router stays publisher-funded.
   */
  static testFundedRouterWithNoKey() {
    const manifest = EngineModelTest.fundedManifest();
    assert.deepEqual(selectTopRouter(manifest, "", ""),
      {baseUrl: EngineModelTest.FUNDED, mock: false, publisherFunded: true, upgradedToByok: false});
    assert.equal(selectTopRouter(manifest, EngineModelTest.FUNDED, "").publisherFunded, true);
  }

  /**
   * A visitor's own key switches to byok_router, even from a saved publisher-funded
   * override, so the key is never sent to the funded router.
   */
  static testVisitorKeyGoesToByok() {
    for (const override of ["", EngineModelTest.FUNDED, `${EngineModelTest.FUNDED}/`]) {
      assert.deepEqual(selectTopRouter(EngineModelTest.fundedManifest(), override, "sk-visitor-0000000000"),
        {baseUrl: EngineModelTest.BYOK, mock: false, publisherFunded: false, upgradedToByok: true});
    }
  }

  /**
   * Only the manifest's word makes a router publisher-funded: not a plain router, not a
   * mock, and not a visitor's own router.
   */
  static testFundedNeedsTheManifest() {
    const plain = {llm_router: {base_url: EngineModelTest.BYOK, byok_router: EngineModelTest.BYOK}};
    assert.equal(selectTopRouter(plain, "", "").publisherFunded, false);
    assert.equal(selectTopRouter(EngineModelTest.fundedManifest({mock: true}), "", "").publisherFunded, false);
    assert.equal(selectTopRouter(EngineModelTest.fundedManifest(), "https://openrouter.ai/api/v1",
      "sk-visitor-0000000000").publisherFunded, false);
  }

  /**
   * A partner network runs on the caller's publisher-funded router, so the site pays for
   * the partner's model calls too.
   */
  static testPartnerUsesFundedRouter() {
    assert.deepEqual(selectPeerRouter({baseUrl: EngineModelTest.FUNDED, mock: false, publisherFunded: true}),
      {baseUrl: EngineModelTest.FUNDED, mock: false, publisherFunded: true});
  }

  /**
   * The check the settings panel uses before any request that carries a key: it matches
   * the funded router however it is written, and nothing else.
   */
  static testPanelCheckMatchesOnlyTheFundedRouter() {
    const manifest = EngineModelTest.fundedManifest();
    assert.equal(isPublisherFundedRouter(manifest, EngineModelTest.FUNDED), true);
    assert.equal(isPublisherFundedRouter(manifest, `${EngineModelTest.FUNDED}/`), true);
    assert.equal(isPublisherFundedRouter(manifest, EngineModelTest.BYOK), false);
    assert.equal(isPublisherFundedRouter(manifest, ""), false);
    assert.equal(isPublisherFundedRouter(EngineModelTest.fundedManifest({mock: true}), EngineModelTest.FUNDED), false);
    assert.equal(isPublisherFundedRouter(EngineModelTest.fundedManifest({publisher_funded: false}), EngineModelTest.FUNDED), false);
  }
}

test("a visitor's model is used by every agent on both sites", EngineModelTest.testVisitorModelForEveryAgent);
test("with no visitor model, a partner runs on the caller's front-agent model", EngineModelTest.testPartnerUsesCallerModel);
test("a model set only on the caller's front agent is passed to the partner", EngineModelTest.testAgentLevelCallerModel);
test("a partner stops at the caller's step limit, and the caller's agents keep theirs", EngineModelTest.testPartnerStopsAtCallerSteps);
test("a partner stops at a lower limit set on the caller's front agent", EngineModelTest.testPartnerFollowsCallerFrontLimit);
test("with no key, the publisher-funded router is chosen and not called a mock", EngineModelTest.testFundedRouterWithNoKey);
test("a visitor's own key goes to byok_router, never to the publisher-funded router", EngineModelTest.testVisitorKeyGoesToByok);
test("only the manifest makes a router publisher-funded", EngineModelTest.testFundedNeedsTheManifest);
test("a partner network runs on the caller's publisher-funded router", EngineModelTest.testPartnerUsesFundedRouter);
test("the panel's key check matches only the publisher-funded router", EngineModelTest.testPanelCheckMatchesOnlyTheFundedRouter);

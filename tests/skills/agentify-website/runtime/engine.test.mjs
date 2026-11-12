// Checks how the skill's runtime runs a partner network for a visitor: on the visitor's
// model, else on the calling site's front-agent model, and within the calling site's step
// limit. The calling site's own agents keep their models and limits.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The sites, the router and the key are fakes behind a stub fetch. No model is called.
import assert from "node:assert/strict";
import test from "node:test";
import { Engine } from "../../../../skills/agentify-website/runtime/engine.js";
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
}

test("a visitor's model is used by every agent on both sites", EngineModelTest.testVisitorModelForEveryAgent);
test("with no visitor model, a partner runs on the caller's front-agent model", EngineModelTest.testPartnerUsesCallerModel);
test("a model set only on the caller's front agent is passed to the partner", EngineModelTest.testAgentLevelCallerModel);
test("a partner stops at the caller's step limit, and the caller's agents keep theirs", EngineModelTest.testPartnerStopsAtCallerSteps);
test("a partner stops at a lower limit set on the caller's front agent", EngineModelTest.testPartnerFollowsCallerFrontLimit);

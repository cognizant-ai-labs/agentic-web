// Checks the safety checks a site adds with engine.addCheck(): beforePeer runs before the
// consent card and before a partner is contacted, beforeAction runs before an action's
// confirmation, and afterAction reads the receipts.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The sites and the router are fakes behind a stub fetch. No model is called.
import assert from "node:assert/strict";
import test from "node:test";
import { ActionRegistry } from "../../../../skills/agentify-website/runtime/actions.js";
import { Engine } from "../../../../skills/agentify-website/runtime/engine.js";
import { FakeSites } from "./fake_sites.mjs";

/**
 * Runs visitor turns on a caller site whose front agent calls a partner network, and
 * website actions through an ActionRegistry, with checks added.
 */
class CheckTest {
  /**
   * Sites where the caller's front agent calls the partner once, then answers.
   *
   * :return: The fake sites.
   */
  static sites() {
    const caller = FakeSites.network({llm_config: {model_name: "test-model"}}, [FakeSites.agent("caller_front", [FakeSites.PARTNER_URL], {})]);
    const partner = FakeSites.network({}, [FakeSites.agent("partner_front", [], {})]);
    return new FakeSites(caller, partner, {caller_front: [FakeSites.PARTNER_TOOL]});
  }

  /**
   * Run one visitor turn with checks added and a consent hook that records each card.
   *
   * :param sites: The fake sites.
   * :param checks: The checks to add.
   * :param setup: Called with the engine before the turn.
   * :return: The engine, the result and the cards shown.
   */
  static async runTurn(sites, checks, setup = () => {}) {
    sites.install();
    try {
      const engine = new Engine({originUrl: FakeSites.CALLER, byokKey: FakeSites.KEY});
      const cards = [];
      engine.onConsent = async (info) => {
        cards.push(info);
        return "allow";
      };
      for (const check of checks) {
        engine.addCheck(check);
      }
      setup(engine);
      const result = await engine.runTurn(FakeSites.REQUEST);
      return {engine, result, cards};
    } finally {
      sites.restore();
    }
  }

  /**
   * Say whether any fetch went to the partner's origin.
   *
   * :param sites: The fake sites.
   * :return: True when the partner was contacted.
   */
  static contactedPartner(sites) {
    return sites.fetched.some((url) => url.startsWith(FakeSites.PARTNER));
  }

  /**
   * A beforePeer refusal shows no card, never contacts the partner, and is in the trace.
   */
  static async testRefusalNeverContactsThePartner() {
    const sites = CheckTest.sites();
    const seen = [];
    const {engine, result, cards} = await CheckTest.runTurn(sites, [{
      beforePeer(info) {
        seen.push(info);
        throw new Error("partner.test is not on this page's list");
      },
    }]);
    assert.equal(result.text, "caller_front answer");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, "network");
    assert.equal(seen[0].url, FakeSites.PARTNER_URL);
    assert.equal(seen[0].requestText, FakeSites.REQUEST);
    assert.deepEqual(cards, [], "A refused partner still got a consent card.");
    assert.equal(CheckTest.contactedPartner(sites), false, "A refused partner was contacted.");
    const refused = engine.trace.export().events.filter((event) => event.kind === "check_refused");
    assert.equal(refused.length, 1);
    assert.equal(refused[0].reason, "partner.test is not on this page's list");
  }

  /**
   * When every check allows, the card is shown and the partner runs, as without checks.
   */
  static async testAllowedPartnerRunsAsBefore() {
    const sites = CheckTest.sites();
    const order = [];
    const {cards} = await CheckTest.runTurn(sites, [
      {beforePeer: () => order.push("first")},
      {beforePeer: async () => order.push("second")},
    ]);
    assert.deepEqual(order, ["first", "second"]);
    assert.equal(cards.length, 1);
    assert.equal(CheckTest.contactedPartner(sites), true);
    assert.deepEqual(sites.models("partner_front").length, 1);
  }

  /**
   * beforePeer runs even when the visitor chose "always" for the partner earlier.
   */
  static async testChecksRunAfterAlways() {
    const sites = CheckTest.sites();
    const {cards} = await CheckTest.runTurn(sites, [{
      beforePeer() {
        throw new Error("refused");
      },
    }], (engine) => engine.consent.set("partner.test", "always"));
    assert.deepEqual(cards, []);
    assert.equal(CheckTest.contactedPartner(sites), false);
  }

  /**
   * The function addCheck returns removes the check.
   */
  static async testRemoveCheck() {
    const sites = CheckTest.sites();
    await CheckTest.runTurn(sites, [], (engine) => {
      const remove = engine.addCheck({
        beforePeer() {
          throw new Error("refused");
        },
      });
      remove();
    });
    assert.equal(CheckTest.contactedPartner(sites), true);
  }

  /**
   * A registry with one irreversible action that records each run.
   *
   * :param checks: The checks.
   * :return: The registry, the plan for one call, and the runs.
   */
  static booking(checks) {
    const runs = [];
    const registry = new ActionRegistry({checks});
    registry.register({base: FakeSites.CALLER, network: "caller_net"}, {
      name: "place_booking",
      description: "Book a trip.",
      effect: "irreversible",
      inputSchema: {type: "object", properties: {seats: {type: "integer"}}, additionalProperties: false},
      execute: (args) => {
        runs.push(args);
        return {booked: args.seats};
      },
    });
    const ref = [...registry.entries.keys()][0];
    const plan = registry.prepare({kind: "action", action: ref, arguments: {seats: 2}});
    return {registry, plan, runs, ref};
  }

  /**
   * A beforeAction refusal starts nothing, skips the dialog, and returns refused receipts.
   */
  static async testActionRefusal() {
    const seen = [];
    const {registry, plan, runs, ref} = CheckTest.booking([{
      beforeAction(items) {
        seen.push(items);
        throw new Error("bookings need a human here");
      },
    }]);
    let asked = false;
    const receipts = await registry.execute(plan, async () => {
      asked = true;
      return true;
    }, "turn-1");
    assert.deepEqual(seen, [[{action: "place_booking", description: "Book a trip.", origin: FakeSites.CALLER,
      effect: "irreversible", arguments: {seats: 2}}]]);
    assert.equal(asked, false, "The dialog was shown after a refusal.");
    assert.deepEqual(runs, []);
    assert.deepEqual(receipts, [{action: ref, status: "refused", error: "bookings need a human here"}]);
  }

  /**
   * afterAction gets the receipts, and an error in it does not change them.
   */
  static async testAfterActionReadsReceipts() {
    const seen = [];
    const {registry, plan, runs} = CheckTest.booking([
      {afterAction: (items, receipts) => seen.push(receipts)},
      {afterAction: () => { throw new Error("ignored"); }},
    ]);
    const receipts = await registry.execute(plan, async () => true, "turn-1");
    assert.deepEqual(runs, [{seats: 2}]);
    assert.equal(receipts[0].status, "succeeded");
    assert.deepEqual(receipts[0].result, {booked: 2});
    assert.deepEqual(seen, [receipts]);
  }

  /**
   * When the visitor declines the dialog, afterAction does not run.
   */
  static async testNoAfterActionWhenDeclined() {
    const seen = [];
    const {registry, plan} = CheckTest.booking([{afterAction: () => seen.push("ran")}]);
    assert.equal(await registry.execute(plan, async () => false, "turn-1"), null);
    assert.deepEqual(seen, []);
  }
}

test("a beforePeer refusal shows no card and never contacts the partner", CheckTest.testRefusalNeverContactsThePartner);
test("with every check allowing, the card is shown and the partner runs", CheckTest.testAllowedPartnerRunsAsBefore);
test("beforePeer runs even after the visitor chose always", CheckTest.testChecksRunAfterAlways);
test("the function addCheck returns removes the check", CheckTest.testRemoveCheck);
test("a beforeAction refusal starts nothing and skips the dialog", CheckTest.testActionRefusal);
test("afterAction reads the receipts and cannot change them", CheckTest.testAfterActionReadsReceipts);
test("afterAction does not run when the visitor declines", CheckTest.testNoAfterActionWhenDeclined);

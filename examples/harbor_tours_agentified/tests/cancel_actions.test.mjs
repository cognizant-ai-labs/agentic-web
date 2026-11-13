// Checks look_up_reservation and cancel_reservation, the site's second irreversible
// action, with copies of the template's irreversible-action tests.
// Run: node --test "<site>/tests/*.test.mjs"
// Today is pinned to Wed, Nov 11, 2026 in site_harness.mjs. The README's demo records:
// HT-3MVK / Thorne (tomorrow's 10 am Seal Rocks Cruise, cancellable today),
// HT-K2HC / Osei (today's 3 pm Harbor Loop, too late to cancel online) and
// HT-T6FY / Lindqvist (Fri, Nov 13 Twilight Sail and Sat, Nov 14 Sea Wall walk).
import assert from "node:assert/strict";
import test from "node:test";
import { dispatchToolCall } from "../runtime/runner.js";
import { SiteHarness } from "./site_harness.mjs";
import { ScriptedModel } from "./scripted_model.mjs";

const IRREVERSIBLE_ACTION = "cancel_reservation";
const BASE = SiteHarness.BASE;
const AssistantMount = SiteHarness.AssistantMount;

/**
 * Tests for looking up and cancelling reservations.
 *
 * All tests in this file share one page, as in one browser tab.
 */
class CancelActionsTest {
  /**
   * Return valid arguments for cancelling HT-T6FY, which can be cancelled until the end
   * of Thu, Nov 12. Spaces and letter case differ from the stored record, as a visitor
   * might type them.
   *
   * :return: The arguments.
   */
  static irreversibleArguments() {
    return {
      code: " ht-t6fy ",
      lastName: "  LINDQVIST ",
    };
  }

  /**
   * Build the item the runtime gives the confirmation dialog.
   *
   * :param args: The cancel_reservation arguments.
   * :return: The item.
   */
  static item(args) {
    return {
      action: IRREVERSIBLE_ACTION,
      origin: BASE,
      effect: "irreversible",
      arguments: args,
    };
  }

  /**
   * Take a snapshot of everything a call could change.
   *
   * :return: The state, the whole page and the stored reservations.
   */
  static async everything() {
    return {
      state: await SiteHarness.state(),
      page: document.snapshot(),
      stored: SiteHarness.allStored(),
    };
  }

  /**
   * Look a reservation up through the page's own manage form.
   *
   * :param code: The code the visitor types.
   * :param lastName: The last name the visitor types.
   */
  static lookUpOnPage(code, lastName) {
    document.getElementById("manage-code").value = code;
    document.getElementById("manage-lastName").value = lastName;
    document.getElementById("manage-form").dispatch("submit");
  }

  /**
   * Reserve one trip through the page's own buttons and form.
   *
   * :param contact: The details to type into the form.
   * :return: The new reservation's code.
   */
  static reserveOnPage(contact) {
    SiteHarness.emptyBasketOnPage();
    SiteHarness.searchOnPage("2026-11-24", 2, 0, 0);
    SiteHarness.addOnPage("11:30 am · Harbor and Lighthouse Loop");
    SiteHarness.fillReserveForm(contact);
    document.getElementById("reserve-form").dispatch("submit");
    return SiteHarness.App.page.confirmedCode;
  }

  /**
   * The look-up returns a documented record by code and last name, in any letter case
   * and with spaces around them, without contact details, and changes nothing.
   */
  static async testLookUpLeavesPageAlone() {
    // The manage panel shows another reservation first.
    CancelActionsTest.lookUpOnPage("HT-K2HC", "Osei");
    const before = await CancelActionsTest.everything();
    SiteHarness.clearFocus();
    const result = await SiteHarness.result("look_up_reservation", CancelActionsTest.irreversibleArguments());
    assert.deepEqual(SiteHarness.focusedIds(), []);
    assert.deepEqual(await CancelActionsTest.everything(), before);
    // Twilight Sail: 2 x $55 + 2 x $1.50 dues. Sea Wall walk: 2 x $15, no dues.
    assert.deepEqual(result, {
      ok: true,
      reservation: {
        code: "HT-T6FY",
        status: "confirmed",
        name: "Tess Lindqvist",
        trips: [
          {
            trip: "Twilight Sail on Fri, Nov 13, 2026 at 4 pm",
            party: "2 adults",
            price: "$113.00",
          },
          {
            trip: "Sea Wall History Walk on Sat, Nov 14, 2026 at 10:30 am",
            party: "2 adults",
            price: "$30.00",
          },
        ],
        total: "$143.00",
        cancelBy: "Thu, Nov 12, 2026",
        note: "You can cancel online until the end of Thu, Nov 12, 2026. Cancelling is free.",
      },
    });
    SiteHarness.assertNoOtherRecords(result, ["HT-T6FY", "Tess", "Lindqvist"]);
    // The state shows the reservation the manage panel shows, and no other.
    assert.equal(before.state.managePanel.code, "HT-K2HC");
    SiteHarness.assertNoOtherRecords(before.state, ["HT-K2HC", "Rami", "Osei"]);
    const late = await SiteHarness.result("look_up_reservation", {
      code: "HT-K2HC",
      lastName: "Osei",
    });
    assert.equal(late.reservation.cancelBy, null);
    assert.equal(late.reservation.note, "Your first trip is today or has passed, so this reservation can't be cancelled online. Please call us on 555-0162.");
  }

  /**
   * The look-up refuses near misses of a code or a last name, and its refusals hold no
   * other visitor's details.
   */
  static async testLookUpRefusesNearMisses() {
    const misses = [
      ["HT-3MVK", "Thorn"],
      ["HT-3MVK", "Thornes"],
      ["HT-3MVK", "Elsie"],
      ["HT-3MV", "Thorne"],
      ["HT-3MVKK", "Thorne"],
      ["HT-3MVK", "Brandt"],
    ];
    const before = await CancelActionsTest.everything();
    for (const pair of misses) {
      const result = await SiteHarness.result("look_up_reservation", {
        code: pair[0],
        lastName: pair[1],
      });
      assert.equal(result.ok, false, pair.join(" / "));
      assert.equal(result.reason, "We couldn't find a reservation with that code and last name.");
      SiteHarness.assertNoOtherRecords(result);
    }
    const empty = await SiteHarness.result("look_up_reservation", {
      code: " ",
      lastName: "Thorne",
    });
    assert.equal(empty.reason, "Enter your reservation code.");
    const noName = await SiteHarness.result("look_up_reservation", {
      code: "HT-3MVK",
      lastName: "",
    });
    assert.equal(noName.reason, "Enter the last name on the reservation.");
    assert.deepEqual(await CancelActionsTest.everything(), before);
  }

  /**
   * The irreversible tool is hidden without a confirmation handler, and declining changes
   * nothing. The state leaves out the reservation, so the look-up reads it back.
   */
  static async testIrreversibleActionNeedsConfirmation() {
    const loaded = await SiteHarness.load();
    const registry = await SiteHarness.registry();
    const model = new ScriptedModel([]);
    const unconfirmed = SiteHarness.context(loaded, registry, model, undefined);
    assert.equal(await SiteHarness.tool(loaded, unconfirmed, IRREVERSIBLE_ACTION), undefined);
    const declining = SiteHarness.context(loaded, registry, model, SiteHarness.decline);
    const entry = await SiteHarness.tool(loaded, declining, IRREVERSIBLE_ACTION);
    assert.ok(entry, `website_${IRREVERSIBLE_ACTION} should be offered when confirmation is available.`);
    const before = await CancelActionsTest.everything();
    const receipt = await dispatchToolCall(declining, entry, CancelActionsTest.irreversibleArguments(), null, []);
    assert.equal(receipt.status, "cancelled");
    assert.deepEqual(await CancelActionsTest.everything(), before);
    const after = await SiteHarness.result("look_up_reservation", CancelActionsTest.irreversibleArguments());
    assert.equal(after.reservation.status, "confirmed");
  }

  /**
   * The cancel dialog shows the reservation the call names, what cancelling costs and
   * until when, not what the page's manage form holds. Building it changes nothing.
   */
  static async testDialogShowsTheRealCall() {
    document.getElementById("manage-code").value = "HT-K2HC";
    document.getElementById("manage-lastName").value = "Osei";
    const before = await CancelActionsTest.everything();
    const args = CancelActionsTest.irreversibleArguments();
    const content = AssistantMount.dialogContent(CancelActionsTest.item(args));
    assert.equal(content.title, "Cancel this reservation?");
    assert.equal(content.sentence, AssistantMount.DIALOGS[IRREVERSIBLE_ACTION].sentence);
    assert.equal(content.refusal, undefined);
    assert.ok(content.exact.includes(JSON.stringify(args, null, 2)));
    assert.deepEqual(content.details, {
      "Reservation": "HT-T6FY",
      "Name": "Tess Lindqvist",
      "Trip 1": "Twilight Sail on Fri, Nov 13, 2026 at 4 pm: 2 adults, $113.00",
      "Trip 2": "Sea Wall History Walk on Sat, Nov 14, 2026 at 10:30 am: 2 adults, $30.00",
      "Total": "$143.00, paid at the ticket hut",
      "Cancelling": "You can cancel online until the end of Thu, Nov 12, 2026. Cancelling is free.",
    });
    SiteHarness.assertNoOtherRecords(content, ["HT-T6FY", "Tess", "Lindqvist"]);
    assert.deepEqual(await CancelActionsTest.everything(), before);
  }

  /**
   * Only the cancel dialog's confirm button confirms. Its decline button and Escape decline.
   */
  static async testDialogAnswers() {
    const item = CancelActionsTest.item(CancelActionsTest.irreversibleArguments());
    const words = AssistantMount.DIALOGS[IRREVERSIBLE_ACTION];
    AssistantMount.defaultReview = SiteHarness.decline;
    const chatInput = SiteHarness.chatInput();
    assert.equal(await SiteHarness.answerDialog(item, words.confirm), true);
    assert.equal(chatInput.focused, true, "review() did not put focus back in the chat input.");
    assert.equal(await SiteHarness.answerDialog(item, words.decline), false);
    assert.equal(await SiteHarness.answerDialog(item, null), false);
  }

  /**
   * Each cancellation the site would refuse opens no dialog, gives the agent the site's
   * reason and changes nothing: each empty field, each kind of near miss, a reservation
   * that is too late to cancel online, and one already cancelled.
   */
  static async testRefusedCallsOpenNoDialog() {
    // A reservation cancelled through the page's own button.
    const code = CancelActionsTest.reserveOnPage({
      firstName: "Ola",
      lastName: "Berg",
      email: "ola@example.com",
      phone: "555 0123",
      notes: "",
    });
    CancelActionsTest.lookUpOnPage(code, "Berg");
    SiteHarness.buttons(document.getElementById("manage-result"), "Cancel this reservation")[0].dispatch("click");
    assert.equal(SiteHarness.stored(code).status, "cancelled");
    const loaded = await SiteHarness.load();
    const registry = await SiteHarness.registry();
    const ctx = SiteHarness.context(loaded, registry, new ScriptedModel([]), AssistantMount.review);
    const entry = await SiteHarness.tool(loaded, ctx, IRREVERSIBLE_ACTION);
    const approved = SiteHarness.context(loaded, registry, new ScriptedModel([]), SiteHarness.approve);
    const approvedEntry = await SiteHarness.tool(loaded, approved, IRREVERSIBLE_ACTION);
    SiteHarness.chatInput();
    const notFound = "We couldn't find a reservation with that code and last name.";
    const refused = [
      [["", "Thorne"], "Enter your reservation code."],
      [["HT-3MVK", "  "], "Enter the last name on the reservation."],
      [["HT-3MVX", "Thorne"], notFound],
      [["HT-3MVK", "Thorn"], notFound],
      [["HT-3MV", "Thorne"], notFound],
      [["HT-K2HC", "Osei"], "Your first trip is today or has passed, so this reservation can't be cancelled online. Please call us on 555-0162."],
      [[code, "Berg"], "This reservation is already cancelled."],
    ];
    const before = await CancelActionsTest.everything();
    for (const pair of refused) {
      const args = {
        code: pair[0][0],
        lastName: pair[0][1],
      };
      const content = AssistantMount.dialogContent(CancelActionsTest.item(args));
      assert.equal(content.refusal, pair[1], JSON.stringify(args));
      const dialogs = document.body.children.length;
      const call = dispatchToolCall(ctx, entry, args, null, []);
      const opened = document.body.children.length - dialogs;
      if (opened) {
        document.body.children.at(-1).close();
      }
      assert.equal(opened, 0, `A dialog opened for a call the site refuses: ${content.refusal}`);
      await assert.rejects(call, {message: content.refusal});
      const direct = await dispatchToolCall(approved, approvedEntry, args, null, []);
      assert.equal(direct.result.ok, false, `The site accepts ${JSON.stringify(args)}.`);
      assert.equal(direct.result.reason, content.refusal);
      SiteHarness.assertNoOtherRecords(direct.result);
      assert.deepEqual(await CancelActionsTest.everything(), before);
    }
  }

  /**
   * A partner site's action named cancel_reservation gets the runtime's dialog, not this
   * page's, and changes nothing here.
   */
  static async testPartnerActionGetsRuntimeDialog() {
    const before = await CancelActionsTest.everything();
    const item = {
      action: IRREVERSIBLE_ACTION,
      origin: "https://partner.example",
      effect: "irreversible",
      arguments: CancelActionsTest.irreversibleArguments(),
    };
    SiteHarness.runtimeReviews = [];
    AssistantMount.defaultReview = SiteHarness.recordRuntimeReview;
    SiteHarness.chatInput();
    const dialogs = document.body.children.length;
    assert.equal(await AssistantMount.review([item]), false);
    assert.equal(document.body.children.length, dialogs, "This page's dialog opened for a partner's action.");
    assert.deepEqual(SiteHarness.runtimeReviews, [[item]]);
    assert.deepEqual(await CancelActionsTest.everything(), before);
  }

  /**
   * An approved cancellation shows the cancelled reservation in the manage panel, even
   * though it showed another one, frees the places in the listed departures, clears the
   * panel's old error and moves no focus.
   */
  static async testApprovedCancelRefreshesThePage() {
    SiteHarness.searchOnPage("2026-11-12", 2, 0, 0);
    assert.ok(SiteHarness.listText("departure-list").includes("10 am · Seal Rocks Cruise | 90 minutes. Full. | This trip is full."));
    // The manage panel shows an earlier refusal under the code field.
    const inserted = SiteHarness.equipErrors("manage");
    CancelActionsTest.lookUpOnPage("HT-NOPE", "Nobody");
    assert.equal(inserted.length, 1);
    SiteHarness.clearFocus();
    const result = await SiteHarness.result(IRREVERSIBLE_ACTION, {
      code: "HT-3MVK",
      lastName: "Thorne",
    });
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual(SiteHarness.focusedIds(), [], `website_${IRREVERSIBLE_ACTION} moved focus.`);
    assert.equal(inserted[0].removed, true, "The old message stayed next to the cancelled reservation.");
    // Seal Rocks: 2 x $38 + 2 x $22 + 4 x $1.50 dues.
    assert.deepEqual(result.reservation, {
      code: "HT-3MVK",
      status: "cancelled",
      name: "Elsie Thorne",
      trips: [
        {
          trip: "Seal Rocks Cruise on Thu, Nov 12, 2026 at 10 am",
          party: "2 adults, 2 children",
          price: "$126.00",
        },
      ],
      total: "$126.00",
      cancelBy: null,
      note: "Cancelled. There is nothing to pay.",
    });
    const panel = document.getElementById("manage-result");
    assert.equal(panel.children[0].textContent, "Reservation HT-3MVK: cancelled");
    assert.equal(panel.children[2].textContent, "Cancelled. There is nothing to pay.");
    assert.equal(SiteHarness.buttons(panel, "Cancel this reservation").length, 0);
    // The 4 places are free again, and the list shows it.
    assert.ok(SiteHarness.listText("departure-list").includes("10 am · Seal Rocks Cruise | 90 minutes. 4 places left. | 2 adults: $79.00 | Add to basket"));
    assert.equal((await SiteHarness.state()).managePanel.status, "cancelled");
  }

  /**
   * An approved cancellation stores the same record as the page's own cancel button, for
   * two reservations that are alike.
   */
  static async testApprovedCancelMatchesThePageButton() {
    const contact = {
      firstName: " Lee ",
      lastName: " Park ",
      email: "lee.park@example.com",
      phone: "555 0188",
      notes: "Two seats near the front",
    };
    const first = CancelActionsTest.reserveOnPage(contact);
    const second = CancelActionsTest.reserveOnPage(contact);
    // The confirmation box shows the second one. The call cancels the first.
    const byAgent = await SiteHarness.result(IRREVERSIBLE_ACTION, {
      code: first,
      lastName: "Park",
    });
    assert.equal(byAgent.ok, true, byAgent.reason);
    assert.equal(document.getElementById("confirmation").hidden, false);
    CancelActionsTest.lookUpOnPage(second, "Park");
    SiteHarness.buttons(document.getElementById("manage-result"), "Cancel this reservation")[0].dispatch("click");
    const agentRecord = SiteHarness.stored(first);
    const pageRecord = SiteHarness.stored(second);
    pageRecord.code = first;
    assert.deepEqual(pageRecord, agentRecord);
    assert.equal(agentRecord.status, "cancelled");
    // The page's own button hides the confirmation box of the reservation it cancels.
    assert.equal(document.getElementById("confirmation").hidden, true);
  }
}

test("the look-up returns a documented record and leaves the page alone", CancelActionsTest.testLookUpLeavesPageAlone);
test("the look-up refuses near misses", CancelActionsTest.testLookUpRefusesNearMisses);
test("cancelling needs confirmation and a decline changes nothing", CancelActionsTest.testIrreversibleActionNeedsConfirmation);
test("the cancel dialog shows the real call and changes nothing", CancelActionsTest.testDialogShowsTheRealCall);
test("only the cancel dialog's confirm button confirms", CancelActionsTest.testDialogAnswers);
test("a cancellation the site would refuse opens no dialog", CancelActionsTest.testRefusedCallsOpenNoDialog);
test("a partner's cancel action gets the runtime's dialog", CancelActionsTest.testPartnerActionGetsRuntimeDialog);
// These change the page for good, so they run last.
test("an approved cancellation refreshes the page", CancelActionsTest.testApprovedCancelRefreshesThePage);
test("an approved cancellation stores the same record as the page's button", CancelActionsTest.testApprovedCancelMatchesThePageButton);

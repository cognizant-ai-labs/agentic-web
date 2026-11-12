// Checks reserve_basket beyond the template's tests: a dialog for several trips, refusals
// that depend on the page's state, text fields at their limits, the lists a reservation
// refreshes, and that no result holds a visitor's contact details.
// Run: node --test "<site>/tests/*.test.mjs"
// Today is pinned to Wed, Nov 11, 2026 in site_harness.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { Calendar } from "../js/calendar.js";
import { SiteHarness } from "./site_harness.mjs";

const AssistantMount = SiteHarness.AssistantMount;

/**
 * Tests for reserving the basket, through the assistant and through the page's own form.
 *
 * All tests in this file share one page, as in one browser tab.
 */
class ReservationActionsTest {
  /**
   * Three trips, in the order they go into the basket. The first, the last and the
   * earliest are different trips: the earliest, on Sun, Nov 15, is the second.
   */
  static THREE_TRIPS = [
    {
      tourId: "harbor-loop",
      date: "2026-11-20",
      time: "15:00",
      adults: 2,
      children: 1,
      under4s: 1,
    },
    {
      tourId: "sea-wall-walk",
      date: "2026-11-15",
      time: "10:30",
      adults: 1,
      children: 2,
      under4s: 0,
    },
    {
      tourId: "seal-rocks",
      date: "2026-11-25",
      time: "14:00",
      adults: 3,
      children: 0,
      under4s: 0,
    },
  ];

  /**
   * A visitor's details with spaces around each value and the optional notes filled in.
   */
  static CONTACT = {
    firstName: "  Mira ",
    lastName: " Okafor  ",
    email: " mira.okafor@example.com ",
    phone: " 555 0142 777 ",
    notes: "  Seasick easily; a birthday on the cruise.  ",
  };

  /**
   * Empty the basket through the page, then add trips through the assistant's write.
   *
   * :param trips: The trips to add, in order.
   * :return: The basket version after the last add.
   */
  static async fillBasket(trips) {
    SiteHarness.emptyBasketOnPage();
    let version = null;
    for (const trip of trips) {
      const added = await SiteHarness.result("add_trip_to_basket", trip);
      assert.equal(added.ok, true, added.reason);
      version = added.basket.version;
    }
    return version;
  }

  /**
   * Build reserve_basket arguments from contact details and a basket version.
   *
   * :param contact: firstName, lastName, email, phone and notes.
   * :param version: The basket version.
   * :return: The arguments.
   */
  static reserveArgs(contact, version) {
    return Object.assign({}, contact, {
      expectedVersion: version,
    });
  }

  /**
   * Build the item the runtime gives the confirmation dialog for a reservation.
   *
   * :param args: The reserve_basket arguments.
   * :return: The item.
   */
  static item(args) {
    return {
      action: "reserve_basket",
      origin: SiteHarness.BASE,
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
   * The dialog for a basket of three trips shows each trip with its price, the total
   * and the last day to cancel, all worked out by hand, with the call's details rather
   * than what the page's form holds. Building it changes nothing.
   */
  static async testDialogForThreeTrips() {
    const version = await ReservationActionsTest.fillBasket(ReservationActionsTest.THREE_TRIPS);
    SiteHarness.fillReserveForm({
      firstName: "Other",
      lastName: "Typist",
      email: "other@example.com",
      phone: "555 0000",
      notes: "Not these notes",
    });
    const before = await ReservationActionsTest.everything();
    const args = ReservationActionsTest.reserveArgs(ReservationActionsTest.CONTACT, version);
    const content = AssistantMount.dialogContent(ReservationActionsTest.item(args));
    assert.equal(content.title, "Reserve these trips?");
    assert.equal(content.refusal, undefined);
    // Harbor Loop: 2 x $24 + $14 + a free child under 4 + 3 x $1.50 dues = $66.50.
    // Sea Wall walk: $15 + 2 x $5, no dues = $25.00.
    // Seal Rocks: 3 x $38 + 3 x $1.50 dues = $118.50. Total $210.00.
    // Cancelling closes at the end of the day before the earliest trip, Sun, Nov 15.
    assert.deepEqual(content.details, {
      "Name": "Mira Okafor",
      "Trip 1": "Harbor and Lighthouse Loop on Fri, Nov 20, 2026 at 3 pm: 2 adults, 1 child, 1 child under 4, $66.50",
      "Trip 2": "Sea Wall History Walk on Sun, Nov 15, 2026 at 10:30 am: 1 adult, 2 children, $25.00",
      "Trip 3": "Seal Rocks Cruise on Wed, Nov 25, 2026 at 2 pm: 3 adults, $118.50",
      "Total": "$210.00, paid at the ticket hut",
      "Email": "mira.okafor@example.com",
      "Mobile phone": "555 0142 777",
      "Notes": "Seasick easily; a birthday on the cruise.",
      "Cancelling": "You can cancel online until the end of Sat, Nov 14, 2026. Cancelling is free.",
    });
    assert.ok(content.exact.includes("\"expectedVersion\": " + version));
    assert.deepEqual(await ReservationActionsTest.everything(), before);
    SiteHarness.assertNoOtherRecords(content);
  }

  /**
   * The same three trips, reserved through the assistant and through the page's own
   * buttons and form, store the same record. The call refreshes the lists on the page.
   */
  static async testThreeTripsStoreTheSameRecordAsTheForm() {
    const version = await ReservationActionsTest.fillBasket(ReservationActionsTest.THREE_TRIPS);
    const storedBefore = SiteHarness.allStored();
    const byAgent = await SiteHarness.result("reserve_basket", ReservationActionsTest.reserveArgs(ReservationActionsTest.CONTACT, version));
    assert.equal(byAgent.ok, true, byAgent.reason);
    assert.equal(byAgent.reservation.total, "$210.00");
    assert.equal(byAgent.reservation.cancelBy, "Sat, Nov 14, 2026");
    assert.deepEqual(byAgent.basket.trips, []);
    const agentRecord = SiteHarness.stored(byAgent.reservation.code);
    assert.equal(SiteHarness.allStored().length, storedBefore.length + 1);
    // Now the page: search each trip's date and party, press Add, then send the form.
    SiteHarness.emptyBasketOnPage();
    const headings = ["3 pm · Harbor and Lighthouse Loop", "10:30 am · Sea Wall History Walk", "2 pm · Seal Rocks Cruise"];
    for (let index = 0; index < 3; index += 1) {
      const trip = ReservationActionsTest.THREE_TRIPS[index];
      SiteHarness.searchOnPage(trip.date, trip.adults, trip.children, trip.under4s);
      SiteHarness.addOnPage(headings[index]);
    }
    SiteHarness.fillReserveForm(ReservationActionsTest.CONTACT);
    document.getElementById("reserve-form").dispatch("submit");
    const pageRecord = SiteHarness.stored(SiteHarness.App.page.confirmedCode);
    assert.notEqual(pageRecord.code, agentRecord.code);
    pageRecord.code = agentRecord.code;
    assert.deepEqual(pageRecord, agentRecord);
    assert.deepEqual(agentRecord.contact, {
      firstName: "Mira",
      lastName: "Okafor",
      email: "mira.okafor@example.com",
      phone: "555 0142 777",
      notes: "Seasick easily; a birthday on the cruise.",
    });
    assert.equal(agentRecord.total, 21000);
    assert.equal(agentRecord.status, "confirmed");
  }

  /**
   * An add and a reservation in one turn work with the version the add returns. The
   * version from a read made before the add is stale and refused.
   */
  static async testAddThenReserveInOneTurn() {
    await ReservationActionsTest.fillBasket([]);
    const read = await SiteHarness.state();
    const added = await SiteHarness.result("add_trip_to_basket", ReservationActionsTest.THREE_TRIPS[0]);
    assert.equal(added.basket.version, read.basket.version + 1);
    const before = await ReservationActionsTest.everything();
    const stale = await SiteHarness.result("reserve_basket", ReservationActionsTest.reserveArgs(ReservationActionsTest.CONTACT, read.basket.version));
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "The basket has changed since it was read. Read it again and check the trips with the visitor.");
    assert.deepEqual(await ReservationActionsTest.everything(), before);
    const fresh = await SiteHarness.result("reserve_basket", ReservationActionsTest.reserveArgs(ReservationActionsTest.CONTACT, added.basket.version));
    assert.equal(fresh.ok, true, fresh.reason);
  }

  /**
   * Refusals that depend on the page's state open no dialog and change nothing: an empty
   * basket, and a trip whose day became today while it sat in the basket.
   */
  static async testRefusalsThatDependOnState() {
    SiteHarness.chatInput();
    const empty = await ReservationActionsTest.fillBasket([]);
    const version = empty === null ? (await SiteHarness.state()).basket.version : empty;
    await ReservationActionsTest.checkRefusal(ReservationActionsTest.reserveArgs(ReservationActionsTest.CONTACT, version), "Your basket is empty. Add a trip first.");
    const later = await ReservationActionsTest.fillBasket([
      {
        tourId: "harbor-loop",
        date: "2026-11-12",
        time: "11:30",
        adults: 1,
        children: 0,
        under4s: 0,
      },
    ]);
    // The page stays open past midnight, and tomorrow's trip is now today's.
    Calendar.fixedToday = "2026-11-12";
    try {
      await ReservationActionsTest.checkRefusal(ReservationActionsTest.reserveArgs(ReservationActionsTest.CONTACT, later), "Harbor and Lighthouse Loop on Thu, Nov 12, 2026 at 11:30 am: Online booking for today has closed. Ask at the ticket hut on Fish Quay for places on today's trips.");
    } finally {
      Calendar.fixedToday = "2026-11-11";
    }
  }

  /**
   * Check that the site refuses a reservation with a reason: the dialog content holds
   * it, review() rejects with it and opens no dialog, the operation returns it, and
   * nothing changes.
   *
   * :param args: The reserve_basket arguments.
   * :param reason: The site's reason.
   */
  static async checkRefusal(args, reason) {
    const before = await ReservationActionsTest.everything();
    const content = AssistantMount.dialogContent(ReservationActionsTest.item(args));
    assert.equal(content.refusal, reason);
    const dialogs = document.body.children.length;
    await assert.rejects(AssistantMount.review([ReservationActionsTest.item(args)]), {message: reason});
    assert.equal(document.body.children.length, dialogs, "A dialog opened for a call the site refuses.");
    const direct = await SiteHarness.result("reserve_basket", args);
    assert.equal(direct.ok, false);
    assert.equal(direct.reason, reason);
    assert.deepEqual(await ReservationActionsTest.everything(), before);
  }

  /**
   * Text fields at their longest are accepted, as are the smallest values: one-letter
   * names, a short email and a phone with exactly 7 digits.
   */
  static async testTextFieldsAtTheirLimits() {
    const longest = {
      firstName: "F".repeat(60),
      lastName: "L".repeat(60),
      email: `${"e".repeat(108)}@example.com`,
      phone: "5".repeat(20),
      notes: "n".repeat(300),
    };
    const smallest = {
      firstName: "A",
      lastName: "B",
      email: "a@b.co",
      phone: "5550199",
      notes: "",
    };
    assert.equal(longest.email.length, 120);
    // The Harbor Loop takes 20 people, so these reservations leave room for the rest.
    const roomy = {
      tourId: "harbor-loop",
      date: "2026-11-27",
      time: "11:30",
      adults: 1,
      children: 0,
      under4s: 0,
    };
    for (const contact of [longest, smallest]) {
      const version = await ReservationActionsTest.fillBasket([roomy]);
      const args = ReservationActionsTest.reserveArgs(contact, version);
      assert.equal(AssistantMount.dialogContent(ReservationActionsTest.item(args)).refusal, undefined);
      const result = await SiteHarness.result("reserve_basket", args);
      assert.equal(result.ok, true, result.reason);
      assert.deepEqual(SiteHarness.stored(result.reservation.code).contact, contact);
    }
    // One character over a schema bound is refused before anything runs.
    const version = await ReservationActionsTest.fillBasket([roomy]);
    const tooLong = ReservationActionsTest.reserveArgs(Object.assign({}, smallest, {
      phone: "5".repeat(21),
    }), version);
    await assert.rejects(SiteHarness.call("reserve_basket", tooLong), /Invalid arguments\.phone/);
  }

  /**
   * An approved reservation shows its code where the page's own form would, empties the
   * basket and lists the departures again with fewer places left, without moving focus.
   */
  static async testReservationRefreshesThePage() {
    await ReservationActionsTest.fillBasket([]);
    SiteHarness.searchOnPage("2026-11-12", 1, 0, 0);
    assert.ok(SiteHarness.listText("departure-list").includes("2 pm · Seal Rocks Cruise | 90 minutes. 2 places left. | 1 adult: $39.50 | Add to basket"));
    const added = await SiteHarness.result("add_trip_to_basket", {
      tourId: "seal-rocks",
      date: "2026-11-12",
      time: "14:00",
      adults: 1,
      children: 0,
      under4s: 0,
    });
    SiteHarness.clearFocus();
    const result = await SiteHarness.result("reserve_basket", ReservationActionsTest.reserveArgs(ReservationActionsTest.CONTACT, added.basket.version));
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual(SiteHarness.focusedIds(), []);
    assert.ok(SiteHarness.listText("departure-list").includes("2 pm · Seal Rocks Cruise | 90 minutes. 1 place left. | 1 adult: $39.50 | Add to basket"));
    assert.deepEqual(SiteHarness.listText("reserve-basket"), ["Your basket is empty. Find a trip and add it here."]);
    assert.equal(document.getElementById("basket-total").hidden, true);
    assert.equal(document.getElementById("confirmation").children[0].textContent, `Reserved! Your reservation code is ${result.reservation.code}.`);
    assert.equal(document.getElementById("status").textContent, `Reservation confirmed. Your reservation code is ${result.reservation.code}.`);
    // The read now says the same as the page.
    const two = await SiteHarness.result("find_departures", {
      date: "2026-11-12",
      adults: 2,
      children: 0,
      under4s: 0,
    });
    for (const departure of two.departures) {
      if (departure.tourId === "seal-rocks" && departure.time === "14:00") {
        assert.equal(departure.problem, "Only 1 place is left on this trip.");
      }
    }
  }

  /**
   * A reservation clears the messages the page showed for the form's last refusal.
   */
  static async testReservationClearsOldErrors() {
    const version = await ReservationActionsTest.fillBasket([ReservationActionsTest.THREE_TRIPS[0]]);
    SiteHarness.fillReserveForm({
      firstName: "Kit",
      lastName: "",
      email: "kit@",
      phone: "",
      notes: "",
    });
    const inserted = SiteHarness.equipErrors("reserve");
    document.getElementById("reserve-form").dispatch("submit");
    assert.equal(inserted.length, 3);
    SiteHarness.clearFocus();
    const result = await SiteHarness.result("reserve_basket", ReservationActionsTest.reserveArgs(ReservationActionsTest.CONTACT, version));
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual(SiteHarness.focusedIds(), []);
    for (const message of inserted) {
      assert.equal(message.removed, true, `"${message.textContent}" stayed next to the confirmation.`);
    }
    // The call kept what the visitor typed in the form.
    assert.equal(SiteHarness.reserveFormValues().firstName, "Kit");
  }

  /**
   * A reservation made with an email, a phone number and notes never shows them to the
   * model: not in the state, the look-up, the cancel dialog or the cancel result. The
   * page shows only the name, trips and total, and so do these.
   */
  static async testContactDetailsStayOutOfResults() {
    await ReservationActionsTest.fillBasket([]);
    SiteHarness.searchOnPage("2026-11-22", 2, 0, 0);
    SiteHarness.addOnPage("11:30 am · Harbor and Lighthouse Loop");
    const secret = {
      firstName: "Quinn",
      lastName: "Harrow",
      email: "quinn.private@example.com",
      phone: "555 0177 123",
      notes: "Surprise party for Robin",
    };
    SiteHarness.fillReserveForm(secret);
    document.getElementById("reserve-form").dispatch("submit");
    const code = SiteHarness.App.page.confirmedCode;
    assert.ok(code);
    const seen = [];
    seen.push(await SiteHarness.state());
    seen.push(await SiteHarness.result("look_up_reservation", {
      code: code,
      lastName: "harrow",
    }));
    seen.push(AssistantMount.dialogContent({
      action: "cancel_reservation",
      origin: SiteHarness.BASE,
      effect: "irreversible",
      arguments: {
        code: code,
        lastName: "Harrow",
      },
    }).details);
    seen.push(await SiteHarness.result("cancel_reservation", {
      code: code,
      lastName: "Harrow",
    }));
    seen.push(await SiteHarness.state());
    for (const value of seen) {
      const text = JSON.stringify(value);
      for (const hidden of [secret.email, secret.phone, secret.notes]) {
        assert.ok(!text.includes(hidden), `${hidden} reached the model: ${text.slice(0, 200)}`);
      }
      SiteHarness.assertNoOtherRecords(value);
    }
    // They do hold what the page shows: the name and the code.
    assert.equal(seen[1].reservation.name, "Quinn Harrow");
    assert.equal(seen[0].confirmation.code, code);
    assert.equal(seen[3].reservation.status, "cancelled");
  }
}

test("the dialog for three trips shows each trip, the total and the deadline", ReservationActionsTest.testDialogForThreeTrips);
test("three trips reserved by the assistant and by the page store the same record", ReservationActionsTest.testThreeTripsStoreTheSameRecordAsTheForm);
test("an add and a reservation work in one turn with the add's version", ReservationActionsTest.testAddThenReserveInOneTurn);
test("refusals that depend on the page's state open no dialog", ReservationActionsTest.testRefusalsThatDependOnState);
test("text fields at their longest and smallest are accepted", ReservationActionsTest.testTextFieldsAtTheirLimits);
test("a reservation refreshes the page's lists without moving focus", ReservationActionsTest.testReservationRefreshesThePage);
test("a reservation clears the form's old error messages", ReservationActionsTest.testReservationClearsOldErrors);
test("contact details never reach the model", ReservationActionsTest.testContactDetailsStayOutOfResults);

// Checks the read actions and the basket writes: find_departures, get_tours_state,
// get_good_to_know, add_trip_to_basket and remove_trip_from_basket.
// Run: node --test "<site>/tests/*.test.mjs"
// Today is pinned to Wed, Nov 11, 2026 in site_harness.mjs. On Thu, Nov 12 the 10 am
// Seal Rocks Cruise is full and the 2 pm one has 2 places left. On Fri, Nov 13 the
// Twilight Sail has 2 places left. On Sat, Nov 14 every tour runs.
import assert from "node:assert/strict";
import test from "node:test";
import { Calendar } from "../js/calendar.js";
import { SiteHarness } from "./site_harness.mjs";

/**
 * Tests for the actions that read the page and change the basket.
 *
 * All tests in this file share one page, as in one browser tab. Each test empties the
 * basket through the page's own buttons first.
 */
class BasketActionsTest {
  /**
   * Build a trip, the arguments add_trip_to_basket takes.
   *
   * :param tourId: The tour id.
   * :param date: The date as "YYYY-MM-DD".
   * :param time: The time as "HH:MM".
   * :param adults: Adult tickets.
   * :param children: Child tickets.
   * :param under4s: Tickets for children under 4.
   * :return: The trip.
   */
  static trip(tourId, date, time, adults, children, under4s) {
    return {
      tourId: tourId,
      date: date,
      time: time,
      adults: adults,
      children: children,
      under4s: under4s,
    };
  }

  /**
   * Build the find_departures arguments for a date and party.
   *
   * :param date: The date as "YYYY-MM-DD".
   * :param adults: Adult tickets.
   * :param children: Child tickets.
   * :param under4s: Tickets for children under 4.
   * :return: The arguments.
   */
  static search(date, adults, children, under4s) {
    return {
      date: date,
      adults: adults,
      children: children,
      under4s: under4s,
    };
  }

  /**
   * Find one departure in a find_departures result.
   *
   * :param result: The find_departures result.
   * :param tourId: The tour id.
   * :param time: The time as "HH:MM".
   * :return: The departure.
   * :raises Error: When the result has no such departure.
   */
  static departure(result, tourId, time) {
    for (const departure of result.departures) {
      if (departure.tourId === tourId && departure.time === time) {
        return departure;
      }
    }
    throw new Error(`No ${tourId} at ${time} in ${JSON.stringify(result).slice(0, 200)}`);
  }

  /**
   * Take a snapshot of everything a call could change: the state, the whole page and the
   * stored reservations.
   *
   * :return: The snapshot.
   */
  static async everything() {
    return {
      state: await SiteHarness.state(),
      page: document.snapshot(),
      stored: SiteHarness.allStored(),
    };
  }

  /**
   * Put the page in a busy state: an earlier search on the page, a trip in the basket
   * from the page's own button, and details typed into the reservation form.
   */
  static fillPanels() {
    SiteHarness.emptyBasketOnPage();
    SiteHarness.searchOnPage("2026-11-13", 1, 1, 0);
    SiteHarness.addOnPage("11:30 am · Harbor and Lighthouse Loop");
    SiteHarness.fillReserveForm({
      firstName: "Draft",
      lastName: "Visitor",
      email: "draft@example.com",
      phone: "555 0111",
      notes: "Draft notes",
    });
  }

  /**
   * A find_departures call lists every departure on the date with the party's price,
   * worked out by hand, and leaves the page and the stored reservations as they were.
   */
  static async testFindDeparturesLeavesPageAlone() {
    BasketActionsTest.fillPanels();
    const before = await BasketActionsTest.everything();
    SiteHarness.clearFocus();
    const result = await SiteHarness.result("find_departures", BasketActionsTest.search("2026-11-14", 2, 1, 0));
    assert.deepEqual(SiteHarness.focusedIds(), []);
    assert.deepEqual(await BasketActionsTest.everything(), before);
    assert.equal(result.ok, true);
    assert.equal(result.day, "Sat, Nov 14, 2026");
    assert.equal(result.party, "2 adults, 1 child");
    const summary = [];
    for (const departure of result.departures) {
      summary.push([departure.time, departure.tourId, departure.placesLeft, departure.price.total, departure.ages]);
    }
    // Seal Rocks: 2 x $38 + $22 + 3 x $1.50 dues. Sea Wall walk: 2 x $15 + $5, no dues.
    // Harbor Loop: 2 x $24 + $14 + $4.50. Twilight Sail: 2 x $55 + $40 + $4.50.
    // The walk has 16 places and two reservations of 2 and 4 people on this day.
    assert.deepEqual(summary, [
      ["10:00", "seal-rocks", 12, "$102.50", "All ages."],
      ["10:30", "sea-wall-walk", 10, "$35.00", "All ages."],
      ["11:30", "harbor-loop", 20, "$66.50", "All ages."],
      ["14:00", "seal-rocks", 12, "$102.50", "All ages."],
      ["15:00", "harbor-loop", 20, "$66.50", "All ages."],
      ["16:00", "twilight-sail", 8, "$154.50", "Ages 12 and over."],
    ]);
    assert.deepEqual(BasketActionsTest.departure(result, "seal-rocks", "10:00").price.lines, [
      "Adults: 2 tickets × $38.00 = $76.00",
      "Children: 1 ticket × $22.00 = $22.00",
      "Harbor dues: 3 passengers × $1.50 = $4.50",
    ]);
    SiteHarness.assertNoOtherRecords(result);
  }

  /**
   * find_departures applies each filter: the tours that run that day, the age limit for
   * children under 4, and the places left, including full and nearly full departures.
   */
  static async testFindDeparturesFilters() {
    // Wednesday: the Twilight Sail runs on Fridays and Saturdays only.
    const wednesday = await SiteHarness.result("find_departures", BasketActionsTest.search("2026-11-18", 2, 0, 0));
    const tours = new Set();
    for (const departure of wednesday.departures) {
      tours.add(departure.tourId);
    }
    assert.deepEqual([...tours].sort(), ["harbor-loop", "sea-wall-walk", "seal-rocks"]);
    // Children under 4 cannot go on the Twilight Sail. They take no place elsewhere.
    const toddler = await SiteHarness.result("find_departures", BasketActionsTest.search("2026-11-14", 2, 0, 1));
    const sail = BasketActionsTest.departure(toddler, "twilight-sail", "16:00");
    assert.equal(sail.problem, "The Twilight Sail is for ages 12 and over.");
    assert.equal(sail.price, null);
    // 2 adults x $38 + a free child under 4 + 2 passengers x $1.50 dues.
    assert.equal(BasketActionsTest.departure(toddler, "seal-rocks", "10:00").price.total, "$79.00");
    // Tomorrow: the 10 am cruise is full and the 2 pm one has 2 places left.
    const three = await SiteHarness.result("find_departures", BasketActionsTest.search("2026-11-12", 3, 0, 0));
    assert.equal(BasketActionsTest.departure(three, "seal-rocks", "10:00").problem, "This trip is full.");
    assert.equal(BasketActionsTest.departure(three, "seal-rocks", "10:00").placesLeft, 0);
    assert.equal(BasketActionsTest.departure(three, "seal-rocks", "14:00").problem, "Only 2 places are left on this trip.");
    // Two adults and a child under 4 need only 2 places, so they fit.
    const fits = await SiteHarness.result("find_departures", BasketActionsTest.search("2026-11-12", 2, 0, 1));
    assert.equal(BasketActionsTest.departure(fits, "seal-rocks", "14:00").problem, "");
    assert.equal(BasketActionsTest.departure(fits, "seal-rocks", "14:00").price.total, "$79.00");
  }

  /**
   * Each tour's price for parties that hit every pricing rule, worked out by hand: adult
   * and child tickets, free children under 4, harbor dues on boat trips only, and the
   * largest party the site allows. Ticket counts change between calls, so a swapped
   * argument would change a price.
   */
  static async testPricesWorkedOutByHand() {
    const cases = [
      // 2 adults, 1 child: boat trips add 3 x $1.50 dues.
      [[2, 1, 0], {
        "seal-rocks": "$102.50",
        "harbor-loop": "$66.50",
        "twilight-sail": "$154.50",
        "sea-wall-walk": "$35.00",
      }],
      // 2 adults, 1 child under 4: free, no place and no dues for the child.
      [[2, 0, 1], {
        "seal-rocks": "$79.00",
        "harbor-loop": "$51.00",
        "twilight-sail": null,
        "sea-wall-walk": "$30.00",
      }],
      // 1 adult, 2 children.
      [[1, 2, 0], {
        "seal-rocks": "$86.50",
        "harbor-loop": "$56.50",
        "twilight-sail": "$139.50",
        "sea-wall-walk": "$25.00",
      }],
      // The largest party: 8 places and 4 children under 4, one per adult.
      [[4, 4, 4], {
        "seal-rocks": "$252.00",
        "harbor-loop": "$164.00",
        "twilight-sail": null,
        "sea-wall-walk": "$80.00",
      }],
      // 8 adults fill the Twilight Sail on a day with no other reservations.
      [[8, 0, 0], {
        "seal-rocks": "$316.00",
        "harbor-loop": "$204.00",
        "twilight-sail": "$452.00",
        "sea-wall-walk": "$120.00",
      }],
    ];
    for (const pair of cases) {
      const party = pair[0];
      const result = await SiteHarness.result("find_departures", BasketActionsTest.search("2026-11-14", party[0], party[1], party[2]));
      const times = {
        "seal-rocks": "10:00",
        "harbor-loop": "11:30",
        "twilight-sail": "16:00",
        "sea-wall-walk": "10:30",
      };
      for (const tourId of Object.keys(pair[1])) {
        const departure = BasketActionsTest.departure(result, tourId, times[tourId]);
        const price = departure.price ? departure.price.total : null;
        assert.equal(price, pair[1][tourId], `${tourId} for ${party.join("/")}`);
      }
    }
  }

  /**
   * find_departures gives the same answer as add_trip_to_basket for the same departure and
   * party: on departures that are nearly full or have an age limit, and for every kind of
   * ticket, including children under 4, who take no place.
   */
  static async testReadAndWriteAgree() {
    SiteHarness.emptyBasketOnPage();
    const cases = [
      ["seal-rocks", "2026-11-12", "14:00", [2, 0, 0]],
      ["seal-rocks", "2026-11-12", "14:00", [2, 0, 1]],
      ["seal-rocks", "2026-11-12", "14:00", [2, 1, 0]],
      ["seal-rocks", "2026-11-12", "10:00", [1, 0, 0]],
      ["twilight-sail", "2026-11-13", "16:00", [1, 1, 0]],
      ["twilight-sail", "2026-11-13", "16:00", [2, 0, 1]],
      ["twilight-sail", "2026-11-13", "16:00", [2, 1, 1]],
      ["twilight-sail", "2026-11-13", "16:00", [3, 0, 0]],
      ["sea-wall-walk", "2026-11-14", "10:30", [4, 4, 4]],
      ["seal-rocks", "2026-11-12", "14:00", [2, 0, 2]],
    ];
    for (const item of cases) {
      const party = item[3];
      const read = await SiteHarness.result("find_departures", BasketActionsTest.search(item[1], party[0], party[1], party[2]));
      const departure = BasketActionsTest.departure(read, item[0], item[2]);
      const trip = BasketActionsTest.trip(item[0], item[1], item[2], party[0], party[1], party[2]);
      const write = await SiteHarness.result("add_trip_to_basket", trip);
      const label = `${item[0]} ${item[1]} ${item[2]} ${party.join("/")}`;
      if (departure.problem) {
        assert.equal(write.ok, false, `${label}: the read refuses but the write adds.`);
        // The write can name more than one problem, such as the age limit and the places.
        assert.ok(write.reason.startsWith(departure.problem), `${label}: ${write.reason}`);
      } else {
        assert.equal(write.ok, true, `${label}: the read offers but the write refuses: ${write.reason}`);
        assert.equal(write.trip.price.total, departure.price.total, label);
        assert.deepEqual(write.trip.price.lines, departure.price.lines, label);
        const removed = await SiteHarness.result("remove_trip_from_basket", {
          tourId: item[0],
          date: item[1],
          time: item[2],
        });
        assert.equal(removed.ok, true);
      }
    }
    // A party the site refuses on any trip gets the same reason from the read and the write.
    for (const party of [[5, 4, 0], [0, 1, 0], [1, 0, 2], [0, 0, 0]]) {
      const read = await SiteHarness.result("find_departures", BasketActionsTest.search("2026-11-14", ...party));
      const write = await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", ...party));
      assert.equal(read.ok, false);
      assert.equal(write.ok, false);
      assert.equal(write.reason, read.reason, party.join("/"));
    }
  }

  /**
   * add_trip_to_basket refuses every rule of the site's check, with the site's own
   * message, and changes nothing. The schema refuses unknown tours and times, bad dates
   * and counts before anything runs.
   */
  static async testAddRefusesEachRule() {
    BasketActionsTest.fillPanels();
    const refused = [
      [BasketActionsTest.trip("seal-rocks", "2026-11-10", "10:00", 1, 0, 0), "That date has passed. Choose a date from tomorrow."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-11", "10:00", 1, 0, 0), "Online booking for today has closed. Ask at the ticket hut on Fish Quay for places on today's trips."],
      [BasketActionsTest.trip("seal-rocks", "2027-01-11", "10:00", 1, 0, 0), "You can book up to 60 days ahead online."],
      [BasketActionsTest.trip("twilight-sail", "2026-11-18", "16:00", 1, 0, 0), "The Twilight Sail runs on Fridays and Saturdays."],
      [BasketActionsTest.trip("sea-wall-walk", "2026-11-19", "10:30", 1, 0, 0), "The Sea Wall History Walk runs on Wednesdays, Saturdays and Sundays."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:30", 1, 0, 0), "The Seal Rocks Cruise runs at 10 am and 2 pm."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 0, 1, 0), "Children under 16 must come with an adult."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 0, 0, 0), "Choose at least 1 ticket."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 1, 0, 2), "Book at least one adult ticket for each child under 4."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 5, 4, 0), "You can book up to 8 places on one trip online. For groups of 9 or more, call us on 555-0162."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 9, 0, 0), "You can book up to 8 places on one trip online. For groups of 9 or more, call us on 555-0162."],
      [BasketActionsTest.trip("twilight-sail", "2026-11-14", "16:00", 2, 0, 1), "The Twilight Sail is for ages 12 and over."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-12", "10:00", 1, 0, 0), "This trip is full."],
      [BasketActionsTest.trip("seal-rocks", "2026-11-12", "14:00", 3, 0, 0), "Only 2 places are left on this trip."],
    ];
    const before = await BasketActionsTest.everything();
    for (const pair of refused) {
      SiteHarness.clearFocus();
      const result = await SiteHarness.result("add_trip_to_basket", pair[0]);
      assert.equal(result.ok, false, JSON.stringify(pair[0]));
      assert.equal(result.reason, pair[1]);
      assert.deepEqual(SiteHarness.focusedIds(), []);
      assert.deepEqual(await BasketActionsTest.everything(), before, `${pair[1]} changed the page.`);
      SiteHarness.assertNoOtherRecords(result);
    }
    const invalid = [
      [Object.assign(BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 1, 0, 0), {
        tourId: "fishing-trip",
      }), /Invalid arguments\.tourId/],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "12:00", 1, 0, 0), /Invalid arguments\.time/],
      [BasketActionsTest.trip("seal-rocks", "2026-02-30", "10:00", 1, 0, 0), /Invalid arguments\.date/],
      [BasketActionsTest.trip("seal-rocks", "14/11/2026", "10:00", 1, 0, 0), /Invalid arguments\.date/],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 1.5, 0, 0), /Invalid arguments\.adults/],
      [BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 1, -1, 0), /Invalid arguments\.children/],
      [Object.assign(BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 1, 0, 0), {
        coupon: "FAMILY20",
      }), /Unexpected arguments\.coupon/],
    ];
    for (const pair of invalid) {
      await assert.rejects(SiteHarness.call("add_trip_to_basket", pair[0]), pair[1]);
    }
    assert.deepEqual(await BasketActionsTest.everything(), before);
  }

  /**
   * A value exactly at each limit the site allows is accepted: tomorrow, 60 days ahead,
   * 8 places, one child under 4 per adult, and 4 trips in the basket. The fifth trip is
   * refused and changes nothing.
   */
  static async testLimitsAreAccepted() {
    SiteHarness.emptyBasketOnPage();
    const accepted = [
      BasketActionsTest.trip("harbor-loop", "2026-11-12", "11:30", 1, 0, 0),
      BasketActionsTest.trip("seal-rocks", "2027-01-10", "14:00", 1, 7, 0),
      BasketActionsTest.trip("sea-wall-walk", "2026-11-15", "10:30", 3, 5, 3),
      BasketActionsTest.trip("twilight-sail", "2026-11-14", "16:00", 8, 0, 0),
    ];
    for (const trip of accepted) {
      const result = await SiteHarness.result("add_trip_to_basket", trip);
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.replaced, false);
    }
    const state = await SiteHarness.state();
    const labels = [];
    for (const trip of state.basket.trips) {
      labels.push(`${trip.trip}: ${trip.party}, ${trip.price.total}`);
    }
    // $24 + $1.50; $38 + 7 x $22 + 8 x $1.50; 3 x $15 + 5 x $5; 8 x $55 + 8 x $1.50.
    assert.deepEqual(labels, [
      "Harbor and Lighthouse Loop on Thu, Nov 12, 2026 at 11:30 am: 1 adult, $25.50",
      "Seal Rocks Cruise on Sun, Jan 10, 2027 at 2 pm: 1 adult, 7 children, $204.00",
      "Sea Wall History Walk on Sun, Nov 15, 2026 at 10:30 am: 3 adults, 5 children, 3 children under 4, $70.00",
      "Twilight Sail on Sat, Nov 14, 2026 at 4 pm: 8 adults, $452.00",
    ]);
    assert.equal(state.basket.total, "$751.50");
    assert.equal(document.getElementById("basket-total").textContent, "Total: $751.50, paid at the ticket hut");
    const before = await BasketActionsTest.everything();
    const fifth = await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("harbor-loop", "2026-11-12", "15:00", 1, 0, 0));
    assert.equal(fifth.ok, false);
    assert.equal(fifth.reason, "Your basket can hold up to 4 trips. Reserve these first, or remove one.");
    assert.deepEqual(await BasketActionsTest.everything(), before);
    // Replacing a trip in a full basket is still allowed.
    const replaced = await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("harbor-loop", "2026-11-12", "11:30", 2, 0, 0));
    assert.equal(replaced.ok, true, replaced.reason);
    assert.equal(replaced.replaced, true);
    SiteHarness.emptyBasketOnPage();
  }

  /**
   * A refused replacement keeps the trip already in the basket, and an accepted one
   * replaces it in the same place.
   */
  static async testRefusedReplacementKeepsTrip() {
    SiteHarness.emptyBasketOnPage();
    await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("harbor-loop", "2026-11-20", "11:30", 1, 0, 0));
    const nearlyFull = BasketActionsTest.trip("seal-rocks", "2026-11-12", "14:00", 2, 0, 0);
    const first = await SiteHarness.result("add_trip_to_basket", nearlyFull);
    assert.equal(first.ok, true, first.reason);
    await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("harbor-loop", "2026-11-21", "11:30", 1, 0, 0));
    const before = await BasketActionsTest.everything();
    const bigger = await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("seal-rocks", "2026-11-12", "14:00", 3, 0, 0));
    assert.equal(bigger.ok, false);
    assert.equal(bigger.reason, "Only 2 places are left on this trip.");
    assert.deepEqual(await BasketActionsTest.everything(), before);
    // One adult and a child under 4 take 1 place: it replaces the trip in its place.
    const smaller = await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("seal-rocks", "2026-11-12", "14:00", 1, 0, 1));
    assert.equal(smaller.ok, true, smaller.reason);
    assert.equal(smaller.replaced, true);
    assert.equal(smaller.basket.version, before.state.basket.version + 1);
    const order = [];
    for (const trip of smaller.basket.trips) {
      order.push(`${trip.trip}: ${trip.party}`);
    }
    assert.deepEqual(order, [
      "Harbor and Lighthouse Loop on Fri, Nov 20, 2026 at 11:30 am: 1 adult",
      "Seal Rocks Cruise on Thu, Nov 12, 2026 at 2 pm: 1 adult, 1 child under 4",
      "Harbor and Lighthouse Loop on Sat, Nov 21, 2026 at 11:30 am: 1 adult",
    ]);
    SiteHarness.emptyBasketOnPage();
  }

  /**
   * remove_trip_from_basket takes one trip out and shows the basket, and refuses a trip
   * that is not in the basket without changing anything.
   */
  static async testRemoveTrip() {
    BasketActionsTest.fillPanels();
    await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 2, 0, 0));
    const before = await SiteHarness.state();
    assert.equal(before.basket.trips.length, 2);
    SiteHarness.clearFocus();
    const removed = await SiteHarness.result("remove_trip_from_basket", {
      tourId: "harbor-loop",
      date: "2026-11-13",
      time: "11:30",
    });
    assert.deepEqual(SiteHarness.focusedIds(), []);
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, "Harbor and Lighthouse Loop on Fri, Nov 13, 2026 at 11:30 am");
    assert.equal(removed.basket.version, before.basket.version + 1);
    assert.equal(removed.basket.trips.length, 1);
    // $76 + 2 x $1.50 dues.
    assert.equal(removed.basket.total, "$79.00");
    assert.equal(SiteHarness.listText("reserve-basket").length, 1);
    assert.equal(document.getElementById("status").textContent, "Removed: Harbor and Lighthouse Loop on Fri, Nov 13, 2026 at 11:30 am.");
    const after = await BasketActionsTest.everything();
    const missing = await SiteHarness.result("remove_trip_from_basket", {
      tourId: "harbor-loop",
      date: "2026-11-13",
      time: "11:30",
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "That trip isn't in your basket.");
    assert.deepEqual(await BasketActionsTest.everything(), after);
    await assert.rejects(SiteHarness.call("remove_trip_from_basket", {
      tourId: "harbor-loop",
      date: "2026-11-13",
    }), /Missing arguments\.time/);
    SiteHarness.emptyBasketOnPage();
  }

  /**
   * The page's own Add and Remove buttons store the same basket as the actions, given the
   * same input.
   */
  static async testPageButtonsMatchActions() {
    SiteHarness.emptyBasketOnPage();
    SiteHarness.searchOnPage("2026-11-14", 2, 0, 1);
    SiteHarness.addOnPage("10 am · Seal Rocks Cruise");
    const byPage = await SiteHarness.state();
    SiteHarness.emptyBasketOnPage();
    const byAction = await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("seal-rocks", "2026-11-14", "10:00", 2, 0, 1));
    assert.deepEqual(byAction.basket.trips, byPage.basket.trips);
    assert.equal(byPage.basket.trips[0].price.total, "$79.00");
    // The page's search is now the last search, which the state shows.
    assert.deepEqual(byPage.search, {
      date: "2026-11-14",
      day: "Sat, Nov 14, 2026",
      adults: 2,
      children: 0,
      under4s: 1,
    });
    SiteHarness.emptyBasketOnPage();
    assert.deepEqual((await SiteHarness.state()).basket.trips, []);
  }

  /**
   * The writes move no focus, and remove the messages the page showed for that panel's
   * last refusal, so an old error never sits next to a new result.
   */
  static async testWritesMoveNoFocusAndClearOldErrors() {
    SiteHarness.emptyBasketOnPage();
    // The page's own form, sent empty, shows a message under each field.
    SiteHarness.fillReserveForm({});
    let inserted = SiteHarness.equipErrors("reserve");
    document.getElementById("reserve-form").dispatch("submit");
    assert.equal(inserted.length, 5);
    assert.equal(inserted[0].textContent, "Your basket is empty. Add a trip first.");
    assert.equal(document.getElementById("reserve-firstName").getAttribute("aria-invalid"), "true");
    SiteHarness.clearFocus();
    const added = await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("harbor-loop", "2026-11-16", "15:00", 1, 0, 0));
    assert.equal(added.ok, true);
    assert.deepEqual(SiteHarness.focusedIds(), [], "website_add_trip_to_basket moved focus.");
    for (const message of inserted) {
      assert.equal(message.removed, true, `"${message.textContent}" stayed next to the new basket.`);
    }
    assert.equal(document.getElementById("reserve-firstName").getAttribute("aria-invalid"), null);
    assert.equal(document.getElementById("reserve-firstName").getAttribute("aria-describedby"), null);
    // With four trips in the basket, the page's own Add button shows a message under it.
    for (const date of ["2026-11-17", "2026-11-18", "2026-11-19"]) {
      await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("harbor-loop", date, "15:00", 1, 0, 0));
    }
    SiteHarness.searchOnPage("2026-11-20", 1, 0, 0);
    inserted = SiteHarness.equipErrors("reserve");
    SiteHarness.addOnPage("3 pm · Harbor and Lighthouse Loop");
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].textContent, "Your basket can hold up to 4 trips. Reserve these first, or remove one.");
    SiteHarness.clearFocus();
    const removed = await SiteHarness.result("remove_trip_from_basket", {
      tourId: "harbor-loop",
      date: "2026-11-17",
      time: "15:00",
    });
    assert.equal(removed.ok, true);
    assert.deepEqual(SiteHarness.focusedIds(), [], "website_remove_trip_from_basket moved focus.");
    assert.equal(inserted[0].removed, true);
  }

  /**
   * The state gives today and the bookable dates with weekdays, worked out from the clock
   * each time it is read, and each tour with its age limit, prices and page facts. It
   * holds no other visitor's reservation.
   */
  static async testStateGivesDatesAndNoOtherRecords() {
    const state = await SiteHarness.state();
    assert.equal(state.today, "Wed, Nov 11, 2026");
    assert.deepEqual(state.bookable, {
      first: "Thu, Nov 12, 2026",
      last: "Sun, Jan 10, 2027",
    });
    assert.equal(state.nextDays.length, 14);
    assert.deepEqual(state.nextDays[0], {
      date: "2026-11-12",
      day: "Thu, Nov 12, 2026",
    });
    assert.deepEqual(state.nextDays[13], {
      date: "2026-11-25",
      day: "Wed, Nov 25, 2026",
    });
    const ages = {};
    for (const tour of state.tours) {
      ages[tour.id] = tour.ages;
    }
    assert.deepEqual(ages, {
      "seal-rocks": "All ages.",
      "harbor-loop": "All ages.",
      "twilight-sail": "Ages 12 and over.",
      "sea-wall-walk": "All ages.",
    });
    assert.equal(state.tours[0].prices, "Adults $38.00, children $22.00, under 4s free.");
    assert.equal(state.tours[2].prices, "Adults $55.00, children $40.00.");
    assert.equal(state.harborDuesPerPassenger, "$1.50");
    // The stand-in has no page text: check the facts' content in a browser.
    assert.deepEqual(Object.keys(state.pageFacts), ["demo", "prices", "booking", "weatherCalls", "payment", "changesAndCancelling", "staying", "contact", "hours"]);
    SiteHarness.assertNoOtherRecords(state);
    // The page may stay open past midnight.
    Calendar.fixedToday = "2026-11-12";
    try {
      const tomorrow = await SiteHarness.state();
      assert.equal(tomorrow.today, "Thu, Nov 12, 2026");
      assert.equal(tomorrow.bookable.first, "Fri, Nov 13, 2026");
    } finally {
      Calendar.fixedToday = "2026-11-11";
    }
  }

  /**
   * The age limit, which the site cannot check against a child's age, comes back with
   * each result it affects: each tour, each departure and each basket trip.
   */
  static async testAgeLimitComesBackWithEachResult() {
    SiteHarness.emptyBasketOnPage();
    const added = await SiteHarness.result("add_trip_to_basket", BasketActionsTest.trip("twilight-sail", "2026-11-14", "16:00", 1, 1, 0));
    assert.equal(added.ok, true, added.reason);
    assert.equal(added.trip.ages, "Ages 12 and over.");
    assert.equal((await SiteHarness.state()).basket.trips[0].ages, "Ages 12 and over.");
    const found = await SiteHarness.result("find_departures", BasketActionsTest.search("2026-11-14", 1, 1, 0));
    for (const departure of found.departures) {
      assert.ok(departure.ages === "All ages." || departure.ages === "Ages 12 and over.", departure.ages);
    }
    assert.equal(BasketActionsTest.departure(found, "twilight-sail", "16:00").ages, "Ages 12 and over.");
    SiteHarness.emptyBasketOnPage();
  }

  /**
   * The Good to know read needs a browser's DOMParser. Under Node it fails before it
   * sends any request, so the runtime reports "unknown". Check its content in a browser.
   */
  static async testGoodToKnowSendsNothingUnderNode() {
    const realFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = requests.push.bind(requests);
    try {
      const receipt = await SiteHarness.call("get_good_to_know", {});
      assert.equal(receipt.status, "unknown");
      assert.match(receipt.error, /needs a browser/);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(requests, []);
  }
}

test("find_departures lists the date's departures and leaves the page alone", BasketActionsTest.testFindDeparturesLeavesPageAlone);
test("find_departures applies the day, age and places filters", BasketActionsTest.testFindDeparturesFilters);
test("prices match amounts worked out by hand", BasketActionsTest.testPricesWorkedOutByHand);
test("find_departures and add_trip_to_basket give the same answer", BasketActionsTest.testReadAndWriteAgree);
test("add_trip_to_basket refuses each rule and changes nothing", BasketActionsTest.testAddRefusesEachRule);
test("values at each limit are accepted", BasketActionsTest.testLimitsAreAccepted);
test("a refused replacement keeps the trip already there", BasketActionsTest.testRefusedReplacementKeepsTrip);
test("remove_trip_from_basket removes one trip and refuses a missing one", BasketActionsTest.testRemoveTrip);
test("the page's own buttons store the same basket as the actions", BasketActionsTest.testPageButtonsMatchActions);
test("the writes move no focus and clear old error messages", BasketActionsTest.testWritesMoveNoFocusAndClearOldErrors);
test("the state gives dates with weekdays and no other visitor's reservation", BasketActionsTest.testStateGivesDatesAndNoOtherRecords);
test("the age limit comes back with each result it affects", BasketActionsTest.testAgeLimitComesBackWithEachResult);
test("the Good to know read sends nothing under Node", BasketActionsTest.testGoodToKnowSendsNothingUnderNode);

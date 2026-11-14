import { Calendar } from "./calendar.js";
import { FareCalculator } from "./fare-calculator.js";
import { GoodToKnow } from "./good-to-know.js";
import { TourData } from "./tour-data.js";
import { TourFacts } from "./tour-facts.js";
import { TripBook } from "./trip-book.js";

/**
 * Connects index.html to the trip book and the basket. The page's forms and
 * buttons call these methods, which run an operation and show its result,
 * any validation messages and a short status announcement.
 *
 * Reserving or cancelling also runs the last search again and prices the
 * basket again, so both show the places left now.
 *
 * The assistant calls the same operations: addTrip, removeTrip, reserveTrips
 * and cancelBooking, with getState, findDepartures, lookUpReservation and
 * goodToKnow to read. An operation returns {ok: false, reason} when it
 * refuses, and never moves focus or resets a form: the handlers do that.
 */
export class ToursPage {
  /** How many days from tomorrow the state lists with their weekdays. */
  static LISTED_DAYS = 14;

  /** Why a reservation is refused when the basket changed after it was read. */
  static STALE_BASKET = "The basket has changed since it was read. Read it again and check the trips with the visitor.";

  /** The page elements whose text and links the state gives as page facts, by name. */
  static FACT_IDS = {
    demo: "demo-note",
    prices: "prices-note",
    booking: "booking-note",
    weatherCalls: "phone-note",
    payment: "payment-note",
    changesAndCancelling: "manage-note",
    staying: "staying-note",
    contact: "contact-line",
    hours: "hours-line",
  };

  /**
   * Create the page controller.
   *
   * :param doc: the page's document
   * :param book: the trip book that runs the operations
   * :param basket: the basket of trips to reserve
   */
  constructor(doc, book, basket) {
    this.doc = doc;
    this.book = book;
    this.basket = basket;
    // The last valid search, run again after a reservation or a cancellation.
    this.lastSearch = null;
    // The code and last name of the reservation in the confirmation box, if it is showing one.
    this.confirmedCode = null;
    this.confirmedLastName = null;
    // The code and last name of the reservation the manage panel shows, if any.
    this.managed = null;
    // Counts basket changes, so a reservation can refuse a basket the visitor has not seen.
    this.version = 0;
    // The validation messages on show, by form id prefix, so they can be removed without searching the page.
    this.shownErrors = new Map();
  }

  /**
   * Render the tours and the basket, fill the tickets and connect the forms.
   */
  start() {
    const date = this.byId("find-date");
    const range = ToursPage.bookableRange();
    date.min = range.first;
    date.max = range.last;
    for (const id of ["find-adults", "find-children", "find-under4s"]) {
      // Adults start at 2. Making that the default too lets a form reset return to it.
      const chosen = id === "find-adults" ? 2 : 0;
      for (let count = 0; count <= TourData.MAX_PLACES; count += 1) {
        this.byId(id).append(new Option(String(count), String(count), count === chosen, count === chosen));
      }
    }
    for (const tour of TourData.TOURS) this.renderTour(tour);
    this.byId("find-form").addEventListener("submit", this.search.bind(this));
    this.byId("reserve-form").addEventListener("submit", this.reserve.bind(this));
    this.byId("manage-form").addEventListener("submit", this.findReservation.bind(this));
    this.renderBasket();
  }

  /**
   * Work out the first and last dates visitors can book online, from today.
   *
   * :return: the first and last dates as "YYYY-MM-DD"
   */
  static bookableRange() {
    const today = Calendar.today();
    return {
      first: Calendar.addDays(today, 1),
      last: Calendar.addDays(today, TourData.BOOK_AHEAD_DAYS),
    };
  }

  /**
   * Write a tour's facts as the page shows them on its card.
   *
   * :param tour: the tour
   * :return: how it travels, its prices, days and times, ages and dogs, as text
   */
  static tourText(tour) {
    // The words live in a page-free module, so the facts for other agent sites match the card.
    return TourFacts.tourText(tour);
  }

  /**
   * Add a card for a tour, with its times, prices, access, ages and dogs.
   *
   * :param tour: the tour
   */
  renderTour(tour) {
    const text = ToursPage.tourText(tour);
    const highlights = this.element("ul", "", "highlights");
    for (const highlight of tour.highlights) highlights.append(this.element("li", highlight));
    const card = this.element("article", "", "tour");
    card.append(
      this.element("h3", tour.name),
      this.element("p", `${tour.minutes} minutes ${text.travel}. ${tour.places} places.`, "facts"),
      this.element("p", text.runs),
      this.element("p", text.prices),
      highlights,
      this.element("p", tour.access, "note"),
      this.element("p", text.ages, "note"),
      this.element("p", text.dogs, "note"),
    );
    this.byId("tour-list").append(card);
  }

  /**
   * Search the departures with the find form and list them.
   *
   * :param event: the form's submit event
   */
  search(event) {
    event.preventDefault();
    const search = {
      date: this.value("find-date"),
      party: {
        adults: Number(this.value("find-adults")),
        children: Number(this.value("find-children")),
        under4s: Number(this.value("find-under4s")),
      },
    };
    const result = this.listDepartures(search);
    if (this.showErrors("find", result.errors)) return;
    this.announce(`${FareCalculator.count(result.departures.length, "trip")} on ${Calendar.format(search.date)}.`);
  }

  /**
   * List the departures on a date. A valid search becomes the last search.
   *
   * :param search: the date and the party
   * :return: the trip book's departures result
   */
  listDepartures(search) {
    const result = this.book.departures(search.date, search.party);
    const list = this.byId("departure-list");
    list.replaceChildren();
    this.lastSearch = result.errors ? null : search;
    if (result.errors) return result;
    for (const departure of result.departures) {
      const tour = TourData.findById(TourData.TOURS, departure.tourId);
      const left = departure.placesLeft > 0 ? `${FareCalculator.count(departure.placesLeft, "place")} left.` : "Full.";
      const item = this.element("li", "", "result");
      item.append(
        this.element("h3", `${Calendar.formatTime(departure.time)} · ${tour.name}`),
        this.element("p", `${tour.minutes} minutes. ${left}`, "facts"),
      );
      if (departure.problem) {
        item.append(this.element("p", departure.problem, "note"));
      } else {
        // The departure gives the tour, date and time, and the search gives the tickets.
        const trip = TripBook.copyTrip(Object.assign({}, departure, search.party));
        const price = `${FareCalculator.partyText(trip)}: ${FareCalculator.money(departure.quote.total)}`;
        item.append(this.element("p", price), this.button("Add to basket", this.addToBasket.bind(this, trip)));
      }
      list.append(item);
    }
    return result;
  }

  /**
   * List every departure on a date for a party, as plain data. It uses the
   * same trip book rules as the find form and changes nothing on the page.
   *
   * :param args: date, adults, children and under4s
   * :return: the departures, each with its price or problem and age limit, or a refusal
   */
  findDepartures(args) {
    const party = ToursPage.partyOf(args);
    const result = this.book.departures(args.date, party);
    if (result.errors) return ToursPage.refusal(result.errors);
    const departures = [];
    for (const departure of result.departures) departures.push(this.describeDeparture(departure));
    return {
      ok: true,
      date: args.date,
      day: Calendar.format(args.date),
      party: FareCalculator.partyText(party),
      departures: departures,
    };
  }

  /**
   * Put a trip in the basket, replacing one for the same departure.
   *
   * :param trip: tourId, date, time, adults, children and under4s
   */
  addToBasket(trip) {
    const result = this.addTrip(trip);
    // Show every refusal under the basket.
    if (!result.ok) this.showErrors("reserve", { basket: result.reason });
  }

  /**
   * Add a trip to the basket, or replace the basket's trip for the same
   * departure, then show the basket. A refused trip changes nothing.
   *
   * :param trip: tourId, date, time, adults, children and under4s
   * :return: the added trip and the basket with its new version, or a refusal
   */
  addTrip(trip) {
    const result = this.basket.add(trip);
    if (result.errors) return ToursPage.refusal(result.errors);
    this.version += 1;
    // A trip went in, so an old message under the basket or the form no longer applies.
    this.clearErrors("reserve");
    this.renderBasket();
    this.announce(`${result.replaced ? "Updated" : "Added"}: ${TripBook.label(result.trip)}.`);
    return {
      ok: true,
      replaced: result.replaced,
      trip: this.describeBasketTrip(result.trip, this.book.quote(result.trip)),
      basket: this.basketState(),
    };
  }

  /**
   * Take a trip out of the basket.
   *
   * :param tourId: the tour
   * :param date: the date as "YYYY-MM-DD"
   * :param time: the time as "HH:MM"
   */
  removeFromBasket(tourId, date, time) {
    const result = this.removeTrip(tourId, date, time);
    if (!result.ok) {
      this.showErrors("reserve", result.errors);
      return;
    }
    // The Remove button is gone, so move focus to the basket.
    this.byId("reserve-basket").focus();
  }

  /**
   * Take a departure's trip out of the basket, then show the basket.
   *
   * :param tourId: the tour
   * :param date: the date as "YYYY-MM-DD"
   * :param time: the time as "HH:MM"
   * :return: the removed trip's name and the basket with its new version, or a refusal
   */
  removeTrip(tourId, date, time) {
    const result = this.basket.remove(tourId, date, time);
    if (result.errors) return ToursPage.refusal(result.errors);
    this.version += 1;
    this.clearErrors("reserve");
    this.renderBasket();
    this.announce(`Removed: ${TripBook.label(result.removed)}.`);
    return {
      ok: true,
      removed: TripBook.label(result.removed),
      basket: this.basketState(),
    };
  }

  /**
   * Price each trip in the basket again, as the places left or today's date
   * may have changed.
   *
   * :return: each trip with its quote result, and the total of the trips that can be reserved
   */
  pricedBasket() {
    const lines = [];
    let total = 0;
    for (const trip of this.basket.trips()) {
      const result = this.book.quote(trip);
      if (!result.errors) total += result.quote.total;
      lines.push({
        trip: trip,
        result: result,
      });
    }
    return {
      lines: lines,
      total: total,
    };
  }

  /**
   * Show the basket's trips, each priced again, and the total.
   */
  renderBasket() {
    const list = this.byId("reserve-basket");
    list.replaceChildren();
    const priced = this.pricedBasket();
    for (const line of priced.lines) {
      const trip = line.trip;
      const item = this.element("li");
      item.append(this.element("h3", TripBook.label(trip)));
      if (line.result.errors) {
        item.append(this.element("p", Object.values(line.result.errors).join(" "), "note"));
      } else {
        item.append(
          this.element("p", `${FareCalculator.partyText(trip)}: ${FareCalculator.money(line.result.quote.total)}`),
          this.element("p", ToursPage.quoteLines(line.result.quote).join("; "), "note"),
        );
      }
      const remove = this.button("Remove", this.removeFromBasket.bind(this, trip.tourId, trip.date, trip.time));
      remove.className = "secondary";
      item.append(remove);
      list.append(item);
    }
    if (priced.lines.length === 0) list.append(this.element("li", "Your basket is empty. Find a trip and add it here."));
    const totalLine = this.byId("basket-total");
    totalLine.textContent = `Total: ${FareCalculator.money(priced.total)}, paid at the ticket hut`;
    totalLine.hidden = priced.lines.length === 0;
  }

  /**
   * Write a quote's lines as the basket shows them, such as
   * "Adults: 2 tickets × $38.00 = $76.00".
   *
   * :param quote: a quote from the fare calculator
   * :return: one text per line
   */
  static quoteLines(quote) {
    const lines = [];
    for (const line of quote.lines) {
      // A free line already says "free", so it needs no amount.
      const amount = line.amount > 0 ? ` = ${FareCalculator.money(line.amount)}` : "";
      lines.push(`${line.label}: ${line.detail}${amount}`);
    }
    return lines;
  }

  /**
   * Update the departures and basket after a reservation or cancellation.
   */
  refresh() {
    if (this.lastSearch) this.listDepartures(this.lastSearch);
    this.renderBasket();
  }

  /**
   * Reserve the basket's trips with the visitor's details and show the code.
   *
   * :param event: the form's submit event
   */
  reserve(event) {
    event.preventDefault();
    const result = this.reserveTrips({
      firstName: this.value("reserve-firstName"),
      lastName: this.value("reserve-lastName"),
      email: this.value("reserve-email"),
      phone: this.value("reserve-phone"),
      notes: this.value("reserve-notes"),
      // The form always reserves the basket the visitor sees now.
      expectedVersion: this.version,
    });
    if (!result.ok) {
      this.showErrors("reserve", result.errors);
      return;
    }
    this.byId("reserve-form").reset();
    this.byId("confirmation").focus();
  }

  /**
   * Check a reservation of the basket's trips without making it: the basket
   * version, then the trip book's rules for the trips and contact details.
   *
   * :param args: firstName, lastName, email, phone, notes and expectedVersion
   * :return: the draft's summary rows, contact details and cancelling note, or a refusal
   */
  checkReservation(args) {
    // A visitor must never confirm one basket and reserve another.
    if (args.expectedVersion !== this.version) return ToursPage.refusal({ basket: ToursPage.STALE_BASKET });
    const trips = this.basket.trips();
    const contact = ToursPage.contactOf(args);
    const errors = this.book.reserveErrors(trips, contact);
    if (Object.keys(errors).length > 0) return ToursPage.refusal(errors);
    const draft = this.book.draft(trips, contact);
    return {
      ok: true,
      summary: this.summaryRows(draft),
      contact: {
        email: draft.contact.email,
        phone: draft.contact.phone,
        notes: draft.contact.notes,
      },
      cancelling: ToursPage.reservationNote(draft, TripBook.lastCancelDay(draft.trips)),
    };
  }

  /**
   * Reserve the basket's trips and show the code in the confirmation box.
   * It runs checkReservation first, and a refusal changes nothing.
   *
   * :param args: firstName, lastName, email, phone, notes and expectedVersion
   * :return: the new reservation, without contact details, or a refusal
   */
  reserveTrips(args) {
    const check = this.checkReservation(args);
    if (!check.ok) return check;
    const result = this.book.reserve(this.basket.trips(), ToursPage.contactOf(args));
    if (result.errors) return ToursPage.refusal(result.errors);
    const reservation = result.reservation;
    const confirmation = this.byId("confirmation");
    confirmation.replaceChildren(
      this.element("h3", `Reserved! Your reservation code is ${reservation.code}.`),
      this.summary(reservation),
      this.element("p", "Nothing has been charged. Keep your code to look up or cancel your reservation."),
    );
    confirmation.hidden = false;
    this.confirmedCode = reservation.code;
    this.confirmedLastName = reservation.contact.lastName;
    this.basket.clear();
    this.version += 1;
    this.clearErrors("reserve");
    // The places are taken now, so the departures must show fewer left.
    this.refresh();
    this.announce(`Reservation confirmed. Your reservation code is ${reservation.code}.`);
    return {
      ok: true,
      reservation: this.describeReservation(reservation, TripBook.lastCancelDay(reservation.trips)),
      basket: this.basketState(),
    };
  }

  /**
   * Look up the reservation named in the manage form.
   *
   * :param event: the form's submit event
   */
  findReservation(event) {
    event.preventDefault();
    const code = this.value("manage-code");
    const lastName = this.value("manage-lastName");
    this.showReservation(this.book.lookUp(code, lastName), code, lastName);
  }

  /**
   * Look up a reservation by code and last name, as plain data, without
   * contact details. It changes nothing on the page.
   *
   * :param code: the reservation code
   * :param lastName: the last name on the reservation
   * :return: the reservation, or a refusal
   */
  lookUpReservation(code, lastName) {
    const result = this.book.lookUp(code, lastName);
    if (result.errors) return ToursPage.refusal(result.errors);
    return {
      ok: true,
      reservation: this.describeReservation(result.reservation, result.cancelBy),
    };
  }

  /**
   * Cancel a reservation that was looked up.
   *
   * :param code: the reservation code
   * :param lastName: the last name on the reservation
   */
  cancelReservation(code, lastName) {
    const result = this.cancelBooking(code, lastName);
    if (!result.ok) {
      this.showReservation({ errors: result.errors }, code, lastName);
      return;
    }
    // The cancel button is gone, so move focus to the updated reservation.
    this.byId("manage-result").focus();
  }

  /**
   * Check that a reservation can be cancelled online, without cancelling it.
   *
   * :param code: the reservation code
   * :param lastName: the last name on the reservation
   * :return: the reservation's code, summary rows and cancelling note, or a refusal
   */
  checkCancel(code, lastName) {
    const found = this.book.cancelErrors(code, lastName);
    if (found.errors) return ToursPage.refusal(found.errors);
    return {
      ok: true,
      code: found.reservation.code,
      summary: this.summaryRows(found.reservation),
      cancelling: ToursPage.reservationNote(found.reservation, found.cancelBy),
    };
  }

  /**
   * Cancel every trip in a reservation and show it in the manage panel. The
   * trip book checks it first, and a refusal changes nothing.
   *
   * :param code: the reservation code
   * :param lastName: the last name on the reservation
   * :return: the cancelled reservation, without contact details, or a refusal
   */
  cancelBooking(code, lastName) {
    const result = this.book.cancel(code, lastName);
    if (result.errors) return ToursPage.refusal(result.errors);
    // The places are free again. Update the other panels first, so the
    // cancellation is the last thing announced.
    this.refresh();
    if (result.reservation.code === this.confirmedCode) this.hideConfirmation();
    this.clearErrors("manage");
    this.renderReservation(result, code, lastName);
    return {
      ok: true,
      reservation: this.describeReservation(result.reservation, result.cancelBy),
    };
  }

  /**
   * Clear and hide the confirmation box after its reservation is cancelled.
   */
  hideConfirmation() {
    const confirmation = this.byId("confirmation");
    confirmation.replaceChildren();
    confirmation.hidden = true;
    this.confirmedCode = null;
    this.confirmedLastName = null;
  }

  /**
   * Show a looked-up or cancelled reservation, with a cancel button if allowed.
   *
   * :param result: the result of lookUp or cancel
   * :param code: the reservation code the visitor entered
   * :param lastName: the last name the visitor entered
   */
  showReservation(result, code, lastName) {
    const box = this.byId("manage-result");
    box.replaceChildren();
    this.managed = null;
    if (this.showErrors("manage", result.errors)) return;
    this.renderReservation(result, code, lastName);
  }

  /**
   * Put a reservation in the manage panel, with a cancel button if allowed.
   *
   * :param result: a lookUp or cancel result with a reservation and cancelBy
   * :param code: the reservation code the visitor entered
   * :param lastName: the last name the visitor entered
   */
  renderReservation(result, code, lastName) {
    const box = this.byId("manage-result");
    box.replaceChildren();
    const reservation = result.reservation;
    const note = ToursPage.reservationNote(reservation, result.cancelBy);
    box.append(this.element("h3", `Reservation ${reservation.code}: ${reservation.status}`), this.summary(reservation));
    box.append(this.element("p", note));
    if (reservation.status === "confirmed" && result.cancelBy) {
      box.append(this.button("Cancel this reservation", this.cancelReservation.bind(this, code, lastName)));
    }
    this.managed = {
      code: code,
      lastName: lastName,
    };
    this.announce(`Reservation ${reservation.code} is ${reservation.status}. ${note}`);
  }

  /**
   * Say whether and until when a reservation can be cancelled online.
   *
   * :param reservation: the reservation
   * :param cancelBy: the last day to cancel online, or null
   * :return: the note the manage panel shows
   */
  static reservationNote(reservation, cancelBy) {
    if (reservation.status === "cancelled") return "Cancelled. There is nothing to pay.";
    if (cancelBy) return `You can cancel online until the end of ${Calendar.format(cancelBy)}. Cancelling is free.`;
    return TripBook.TOO_LATE_TO_CANCEL;
  }

  /**
   * List a reservation's name, trips and total, without contact details.
   *
   * :param reservation: the reservation
   * :return: label and value pairs
   */
  summaryRows(reservation) {
    const rows = [["Name", `${reservation.contact.firstName} ${reservation.contact.lastName}`]];
    for (let index = 0; index < reservation.trips.length; index += 1) {
      const trip = reservation.trips[index];
      const price = FareCalculator.money(trip.quote.total);
      rows.push([`Trip ${index + 1}`, `${TripBook.label(trip)}: ${FareCalculator.partyText(trip)}, ${price}`]);
    }
    rows.push(["Total", `${FareCalculator.money(reservation.total)}, paid at the ticket hut`]);
    return rows;
  }

  /**
   * Describe a reservation's name, trips and total, without contact details.
   *
   * :param reservation: the reservation
   * :return: a description list
   */
  summary(reservation) {
    const list = this.element("dl", "", "summary");
    for (const pair of this.summaryRows(reservation)) list.append(this.element("dt", pair[0]), this.element("dd", pair[1]));
    return list;
  }

  /**
   * Read the page as plain data: today and the bookable days, the tours, the
   * basket with its version, what each panel shows and the page's own facts.
   * It leaves out other visitors' reservations and contact details.
   *
   * :return: a fresh copy of the state
   */
  getState() {
    const today = Calendar.today();
    const range = ToursPage.bookableRange();
    const days = [];
    for (let offset = 1; offset <= ToursPage.LISTED_DAYS; offset += 1) {
      const date = Calendar.addDays(today, offset);
      days.push({
        date: date,
        day: Calendar.format(date),
      });
    }
    const tours = [];
    for (const tour of TourData.TOURS) tours.push(ToursPage.describeTour(tour));
    return {
      today: Calendar.format(today),
      bookable: {
        first: Calendar.format(range.first),
        last: Calendar.format(range.last),
      },
      nextDays: days,
      tours: tours,
      harborDuesPerPassenger: FareCalculator.money(TourData.HARBOR_DUES),
      limits: {
        placesPerTrip: TourData.MAX_PLACES,
        tripsPerReservation: TourData.MAX_TRIPS,
      },
      basket: this.basketState(),
      search: this.searchState(),
      confirmation: this.panelReservation(this.confirmedCode, this.confirmedLastName),
      managePanel: this.managed ? this.panelReservation(this.managed.code, this.managed.lastName) : null,
      pageFacts: this.pageFacts(),
    };
  }

  /**
   * Describe a tour as plain data, with its prices as the page shows them.
   *
   * :param tour: the tour
   * :return: the tour's facts
   */
  static describeTour(tour) {
    const text = ToursPage.tourText(tour);
    const times = [];
    for (const time of tour.times) {
      times.push({
        time: time,
        startsAt: Calendar.formatTime(time),
      });
    }
    return {
      id: tour.id,
      name: tour.name,
      kind: tour.kind,
      vessel: tour.vessel,
      minutes: tour.minutes,
      runs: text.runs,
      times: times,
      placesPerDeparture: tour.places,
      prices: text.prices,
      ages: text.ages,
      dogs: text.dogs,
      access: tour.access,
      highlights: tour.highlights.slice(),
    };
  }

  /**
   * Describe one departure from the trip book as plain data.
   *
   * :param departure: a departure with tourId, time, placesLeft, problem and quote
   * :return: the departure, with the trip's age limit, which the site does not check
   */
  describeDeparture(departure) {
    const tour = TourData.findById(TourData.TOURS, departure.tourId);
    return {
      tourId: departure.tourId,
      tour: tour.name,
      time: departure.time,
      startsAt: Calendar.formatTime(departure.time),
      minutes: tour.minutes,
      placesLeft: departure.placesLeft,
      ages: ToursPage.tourText(tour).ages,
      problem: departure.problem,
      price: departure.quote ? ToursPage.describeQuote(departure.quote) : null,
    };
  }

  /**
   * Describe a quote with amounts as the page shows them.
   *
   * :param quote: a quote from the fare calculator
   * :return: the total and each line as text
   */
  static describeQuote(quote) {
    return {
      total: FareCalculator.money(quote.total),
      lines: ToursPage.quoteLines(quote),
    };
  }

  /**
   * Describe the basket: its version, each trip priced again, and the total.
   *
   * :return: the basket as plain data
   */
  basketState() {
    const priced = this.pricedBasket();
    const trips = [];
    for (const line of priced.lines) trips.push(this.describeBasketTrip(line.trip, line.result));
    return {
      version: this.version,
      trips: trips,
      total: FareCalculator.money(priced.total),
    };
  }

  /**
   * Describe one basket trip, with its price or why it can't be reserved now.
   *
   * :param trip: tourId, date, time, adults, children and under4s
   * :param result: the trip book's quote result for the trip
   * :return: the trip as plain data
   */
  describeBasketTrip(trip, result) {
    const tour = TourData.findById(TourData.TOURS, trip.tourId);
    return {
      tourId: trip.tourId,
      date: trip.date,
      time: trip.time,
      adults: trip.adults,
      children: trip.children,
      under4s: trip.under4s,
      trip: TripBook.label(trip),
      party: FareCalculator.partyText(trip),
      ages: ToursPage.tourText(tour).ages,
      price: result.errors ? null : ToursPage.describeQuote(result.quote),
      problem: result.errors ? Object.values(result.errors).join(" ") : "",
    };
  }

  /**
   * Describe the last search the departure list shows.
   *
   * :return: its date and tickets, or null when the list is empty
   */
  searchState() {
    if (!this.lastSearch) return null;
    return {
      date: this.lastSearch.date,
      day: Calendar.format(this.lastSearch.date),
      adults: this.lastSearch.party.adults,
      children: this.lastSearch.party.children,
      under4s: this.lastSearch.party.under4s,
    };
  }

  /**
   * Describe the reservation a panel shows, as it is now.
   *
   * :param code: the reservation code, or null
   * :param lastName: the last name on the reservation
   * :return: the reservation, or null when the panel shows none
   */
  panelReservation(code, lastName) {
    if (!code) return null;
    const result = this.book.lookUp(code, lastName);
    if (result.errors) return null;
    return this.describeReservation(result.reservation, result.cancelBy);
  }

  /**
   * Describe a reservation as plain data, without contact details, as the
   * page's summary shows it.
   *
   * :param reservation: the reservation
   * :param cancelBy: the last day to cancel online, or null
   * :return: the code, status, name, trips, total and cancelling note
   */
  describeReservation(reservation, cancelBy) {
    const trips = [];
    for (const trip of reservation.trips) {
      trips.push({
        trip: TripBook.label(trip),
        party: FareCalculator.partyText(trip),
        price: FareCalculator.money(trip.quote.total),
      });
    }
    return {
      code: reservation.code,
      status: reservation.status,
      name: `${reservation.contact.firstName} ${reservation.contact.lastName}`,
      trips: trips,
      total: FareCalculator.money(reservation.total),
      cancelBy: cancelBy ? Calendar.format(cancelBy) : null,
      note: ToursPage.reservationNote(reservation, cancelBy),
    };
  }

  /**
   * Read the page's own facts, such as payment and where to stay, from its
   * elements, with each link's address.
   *
   * :return: each fact's text and links, by name
   */
  pageFacts() {
    const facts = {};
    for (const name of Object.keys(ToursPage.FACT_IDS)) {
      const element = this.byId(ToursPage.FACT_IDS[name]);
      const links = [];
      for (const link of element.querySelectorAll("a")) {
        // textContent leaves out where a link goes, so read its href too.
        links.push({
          text: ToursPage.oneLine(link.textContent),
          href: link.href,
        });
      }
      facts[name] = {
        text: ToursPage.oneLine(element.textContent),
        links: links,
      };
    }
    return facts;
  }

  /**
   * Read the Good to know page, which is policies.html next to this page.
   *
   * :return: a promise of the page's sections
   */
  goodToKnow() {
    return GoodToKnow.read(new URL("policies.html", this.doc.baseURI).href);
  }

  /**
   * List the tour ids, for the assistant's choices.
   *
   * :return: the ids
   */
  tourIds() {
    const ids = [];
    for (const tour of TourData.TOURS) ids.push(tour.id);
    return ids;
  }

  /**
   * List every departure time of every tour, once each, in order.
   *
   * :return: the times as "HH:MM"
   */
  departureTimes() {
    const times = [];
    for (const tour of TourData.TOURS) {
      for (const time of tour.times) {
        if (!times.includes(time)) times.push(time);
      }
    }
    return times.sort();
  }

  /**
   * Take the tickets out of an assistant's call.
   *
   * :param args: adults, children and under4s, among other arguments
   * :return: the party
   */
  static partyOf(args) {
    return {
      adults: args.adults,
      children: args.children,
      under4s: args.under4s,
    };
  }

  /**
   * Take the contact details out of a reservation call.
   *
   * :param args: firstName, lastName, email, phone and notes, among other arguments
   * :return: the contact details
   */
  static contactOf(args) {
    return {
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      phone: args.phone,
      notes: args.notes,
    };
  }

  /**
   * Turn the trip book's messages by field into a refusal for the assistant.
   *
   * :param errors: messages by field name
   * :return: ok false, the messages joined as the reason, the first field, and the messages by field
   */
  static refusal(errors) {
    const copy = Object.assign({}, errors);
    return {
      ok: false,
      reason: Object.values(copy).join(" "),
      field: Object.keys(copy)[0],
      errors: copy,
    };
  }

  /**
   * Show validation messages under their fields, replacing earlier ones.
   *
   * :param prefix: the id prefix of the form's fields, such as "reserve"
   * :param errors: messages by field name, or null when there are none
   * :return: true when there were messages to show
   */
  showErrors(prefix, errors) {
    this.clearErrors(prefix);
    const names = errors ? Object.keys(errors) : [];
    const shown = [];
    for (const name of names) {
      const field = this.byId(`${prefix}-${name}`);
      const message = this.element("p", errors[name], "field-error");
      message.id = `${prefix}-${name}-error`;
      field.after(message);
      field.setAttribute("aria-describedby", message.id);
      // A fieldset or list can't be marked invalid, so only mark form controls.
      if (field.matches("input, select, textarea")) field.setAttribute("aria-invalid", "true");
      shown.push({
        field: field,
        message: message,
      });
    }
    this.shownErrors.set(prefix, shown);
    if (names.length === 0) return false;
    // Focus the first field with a message, in page order.
    this.doc.querySelector(`.field-error[id^="${prefix}-"]`).previousElementSibling.focus();
    this.announce(`Please check the form. ${Object.values(errors).join(" ")}`);
    return true;
  }

  /**
   * Remove a form's validation messages, without moving focus.
   *
   * :param prefix: the id prefix of the form's fields, such as "reserve"
   */
  clearErrors(prefix) {
    for (const old of this.shownErrors.get(prefix) || []) {
      old.field.removeAttribute("aria-invalid");
      old.field.removeAttribute("aria-describedby");
      old.message.remove();
    }
    this.shownErrors.delete(prefix);
  }

  /**
   * Make a button that calls a handler when clicked.
   *
   * :param text: the button's label
   * :param handler: the bound method to call
   * :return: the button
   */
  button(text, handler) {
    const button = this.element("button", text);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  }

  /**
   * Make an element. Text goes in textContent, so visitor input is never read as HTML.
   *
   * :param tag: the tag name
   * :param text: the text, or an empty string
   * :param className: the class name, if any
   * :return: the element
   */
  element(tag, text, className) {
    const node = this.doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /**
   * Find an element by its id.
   *
   * :param id: the id
   * :return: the element
   */
  byId(id) {
    return this.doc.getElementById(id);
  }

  /**
   * Read a form field's value without surrounding spaces.
   *
   * :param id: the field's id
   * :return: the trimmed value
   */
  value(id) {
    return this.byId(id).value.trim();
  }

  /**
   * Write text as one line, without the page's line breaks and indents.
   *
   * :param text: the text
   * :return: the text on one line
   */
  static oneLine(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  /**
   * Announce a message in the page's live status region.
   *
   * :param message: the message
   */
  announce(message) {
    this.byId("status").textContent = message;
  }
}

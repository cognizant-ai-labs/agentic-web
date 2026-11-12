import { Calendar } from "./calendar.js";
import { FareCalculator } from "./fare-calculator.js";
import { TourData } from "./tour-data.js";
import { TripRules } from "./trip-rules.js";

/**
 * Keeps the tour company's reservations in memory and runs the operations:
 * departures, quote, reserve, look up and cancel.
 *
 * Each operation returns an object. When the input breaks a rule, it holds
 * only errors, which maps form field names to messages. Reloading the page
 * starts again from the existing reservations in TourData.
 */
export class TripBook {
  /** Why a reservation whose first trip is today or earlier can't be cancelled online. */
  static TOO_LATE_TO_CANCEL = "Your first trip is today or has passed, so this reservation can't be cancelled online. "
    + "Please call us on 555-0162.";

  /**
   * Create the book with the existing reservations, dated from today.
   */
  constructor() {
    this.reservations = [];
    for (const existing of TourData.EXISTING_RESERVATIONS) {
      const trips = [];
      for (const seed of existing.trips) {
        const trip = TripBook.copyTrip(seed);
        const tour = TourData.findById(TourData.TOURS, seed.tourId);
        trip.date = TripBook.firstRun(tour, Calendar.addDays(Calendar.today(), seed.fromToday));
        trips.push(trip);
      }
      // The seeds have names only, so the other contact details are empty.
      this.reservations.push(TripBook.record(existing.code, trips, TripRules.cleanContact(existing)));
    }
  }

  /**
   * Find the first date, on or after a date, on which a tour runs.
   *
   * :param tour: the tour
   * :param from: the earliest date as "YYYY-MM-DD"
   * :return: the date, or null when the tour runs on no day
   */
  static firstRun(tour, from) {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = Calendar.addDays(from, offset);
      if (tour.days.includes(Calendar.toDate(date).getUTCDay())) return date;
    }
    return null;
  }

  /**
   * Build a confirmed reservation with a copy and a quote for each trip.
   *
   * :param code: the reservation code
   * :param trips: the trips, each with tourId, date, time and tickets
   * :param contact: the visitor's contact details
   * :return: the reservation
   */
  static record(code, trips, contact) {
    const stored = [];
    let total = 0;
    for (const trip of trips) {
      const copy = TripBook.copyTrip(trip);
      copy.quote = FareCalculator.quote(TourData.findById(TourData.TOURS, copy.tourId), copy);
      total += copy.quote.total;
      stored.push(copy);
    }
    return {
      code: code,
      status: "confirmed",
      contact: contact,
      trips: stored,
      total: total,
    };
  }

  /**
   * Count the adults and children with confirmed places on one departure.
   *
   * :param tourId: the tour
   * :param date: the date as "YYYY-MM-DD"
   * :param time: the time as "HH:MM"
   * :return: the adults plus children already booked
   */
  placesTaken(tourId, date, time) {
    let taken = 0;
    for (const reservation of this.reservations) {
      if (reservation.status !== "confirmed") continue;
      for (const trip of reservation.trips) {
        if (trip.tourId === tourId && trip.date === date && trip.time === time) taken += trip.adults + trip.children;
      }
    }
    return taken;
  }

  /**
   * List every departure on a date, sorted by time. Each one has its tourId,
   * date, time and placesLeft, and either a quote for the party or a problem.
   *
   * :param date: the date as "YYYY-MM-DD"
   * :param party: adults, children and under4s
   * :return: errors, or the departures
   */
  departures(date, party) {
    const errors = {};
    const dateProblem = TripRules.dateProblem(date);
    if (dateProblem) errors.date = dateProblem;
    const partyProblem = TripRules.partyProblem(party);
    if (partyProblem) errors.tickets = partyProblem;
    if (Object.keys(errors).length > 0) return { errors };
    const day = Calendar.toDate(date).getUTCDay();
    const departures = [];
    for (const tour of TourData.TOURS) {
      if (!tour.days.includes(day)) continue;
      for (const time of tour.times) {
        const placesLeft = tour.places - this.placesTaken(tour.id, date, time);
        const problem = TripRules.fitProblem(tour, party, placesLeft);
        departures.push({
          tourId: tour.id,
          date: date,
          time: time,
          placesLeft: placesLeft,
          problem: problem,
          quote: problem ? null : FareCalculator.quote(tour, party),
        });
      }
    }
    departures.sort(TripBook.byTime);
    return { departures };
  }

  /**
   * Price one trip, if it follows every rule and the departure has room.
   *
   * :param trip: tourId, date, time, adults, children and under4s
   * :return: errors, or a copy of the trip and its itemized quote
   */
  quote(trip) {
    const draft = TripBook.copyTrip(trip);
    const tour = TourData.findById(TourData.TOURS, draft.tourId);
    const errors = TripRules.departureErrors(tour, draft);
    const partyProblem = TripRules.partyProblem(draft);
    if (partyProblem) errors.tickets = partyProblem;
    if (Object.keys(errors).length > 0) return { errors };
    // The fit rules need a real departure and party, so they run last.
    const ageProblem = TripRules.ageProblem(tour, draft);
    if (ageProblem) errors.tickets = ageProblem;
    const placesLeft = tour.places - this.placesTaken(draft.tourId, draft.date, draft.time);
    const placesProblem = TripRules.placesProblem(draft.adults + draft.children, placesLeft);
    if (placesProblem) errors.time = placesProblem;
    if (Object.keys(errors).length > 0) return { errors };
    return {
      trip: draft,
      quote: FareCalculator.quote(tour, draft),
    };
  }

  /**
   * Reserve the trips under one new code. No payment is taken. Nothing is
   * stored unless every trip and detail is fine, and details are trimmed.
   *
   * :param trips: the trips, each with tourId, date, time and tickets
   * :param contact: first name, last name, email, phone and notes
   * :return: errors, or the new reservation with its code
   */
  reserve(trips, contact) {
    const details = TripRules.cleanContact(contact);
    const basketProblem = this.basketProblem(trips);
    const errors = basketProblem ? { basket: basketProblem } : {};
    Object.assign(errors, TripRules.contactErrors(details));
    if (Object.keys(errors).length > 0) return { errors };
    const reservation = TripBook.record(this.newCode(), trips, details);
    this.reservations.push(reservation);
    return { reservation };
  }

  /**
   * Check the trips for a reservation: 1 to MAX_TRIPS trips, each departure
   * once, and each trip priced with no errors.
   *
   * :param trips: the trips
   * :return: a message, or an empty string when every trip can be reserved
   */
  basketProblem(trips) {
    if (!Array.isArray(trips) || trips.length === 0) return "Your basket is empty. Add a trip first.";
    if (trips.length > TourData.MAX_TRIPS) return `You can reserve up to ${TourData.MAX_TRIPS} trips at a time.`;
    const seen = [];
    for (const trip of trips) {
      const copy = TripBook.copyTrip(trip);
      const key = `${copy.tourId} ${copy.date} ${copy.time}`;
      if (seen.includes(key)) return "Each trip can appear only once in a reservation.";
      seen.push(key);
    }
    const messages = [];
    for (let index = 0; index < trips.length; index += 1) {
      const result = this.quote(trips[index]);
      if (result.errors) {
        const label = TripBook.label(TripBook.copyTrip(trips[index])) || `Trip ${index + 1}`;
        messages.push(`${label}: ${Object.values(result.errors).join(" ")}`);
      }
    }
    return messages.join(" ");
  }

  /**
   * Copy a trip's departure and tickets.
   *
   * :param trip: tourId, date, time, adults, children and under4s
   * :return: the copy
   */
  static copyTrip(trip) {
    const given = trip || {};
    return {
      tourId: given.tourId,
      date: given.date,
      time: given.time,
      adults: given.adults,
      children: given.children,
      under4s: given.under4s,
    };
  }

  /**
   * Name a trip, such as "Seal Rocks Cruise on Thu, Nov 12, 2026 at 2 pm".
   * A date or time that isn't valid for the tour is left out.
   *
   * :param trip: tourId, date and time
   * :return: the name, or an empty string when the trip's tour is unknown
   */
  static label(trip) {
    const tour = TourData.findById(TourData.TOURS, trip.tourId);
    if (!tour) return "";
    let label = tour.name;
    if (Calendar.isDate(trip.date)) label += ` on ${Calendar.format(trip.date)}`;
    if (tour.times.includes(trip.time)) label += ` at ${Calendar.formatTime(trip.time)}`;
    return label;
  }

  /**
   * Order two departures by time, for sort().
   *
   * :param a: one departure
   * :param b: the other departure
   * :return: below 0 when a comes first, above 0 when b does, else 0
   */
  static byTime(a, b) {
    if (a.time < b.time) return -1;
    if (a.time > b.time) return 1;
    return 0;
  }

  /**
   * Look up a reservation by code and last name. Both are required. cancelBy
   * is the last day to cancel online, or null when it can't be cancelled.
   *
   * :param code: the reservation code, in any letter case
   * :param lastName: the last name on the reservation, in any letter case
   * :return: errors, or the reservation and cancelBy
   */
  lookUp(code, lastName) {
    const wantedCode = String(code || "").trim().toUpperCase();
    const wantedName = String(lastName || "").trim().toLowerCase();
    const errors = {};
    if (!wantedCode) errors.code = "Enter your reservation code.";
    if (!wantedName) errors.lastName = "Enter the last name on the reservation.";
    if (Object.keys(errors).length > 0) return { errors };
    for (const reservation of this.reservations) {
      if (reservation.code !== wantedCode || reservation.contact.lastName.toLowerCase() !== wantedName) continue;
      let first = reservation.trips[0].date;
      for (const trip of reservation.trips) {
        if (trip.date < first) first = trip.date;
      }
      // Online cancelling closes at the end of the day before the first trip.
      const open = reservation.status === "confirmed" && first > Calendar.today();
      return {
        reservation: reservation,
        cancelBy: open ? Calendar.addDays(first, -1) : null,
      };
    }
    return { errors: { code: "We couldn't find a reservation with that code and last name." } };
  }

  /**
   * Cancel every trip in a reservation. It is free, and frees the places.
   *
   * :param code: the reservation code
   * :param lastName: the last name on the reservation
   * :return: errors, or the cancelled reservation
   */
  cancel(code, lastName) {
    const found = this.lookUp(code, lastName);
    if (found.errors) return found;
    if (found.reservation.status === "cancelled") return { errors: { code: "This reservation is already cancelled." } };
    if (!found.cancelBy) return { errors: { code: TripBook.TOO_LATE_TO_CANCEL } };
    found.reservation.status = "cancelled";
    found.cancelBy = null;
    return found;
  }

  /**
   * Make a reservation code that no other reservation uses.
   *
   * :return: a code such as "HT-3MVK"
   */
  newCode() {
    // Leave out 0, O, 1 and I, which are easy to mix up.
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "HT-";
    while (code.length < 7) code += letters[Math.floor(Math.random() * letters.length)];
    for (const reservation of this.reservations) {
      if (reservation.code === code) return this.newCode();
    }
    return code;
  }
}

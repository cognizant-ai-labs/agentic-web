import { TourData } from "./tour-data.js";
import { TripBook } from "./trip-book.js";

/**
 * Holds up to MAX_TRIPS trips in page memory, in the order they were added.
 * The trip book checks and prices each trip before it goes in, and each
 * departure appears at most once.
 */
export class TripBasket {
  /**
   * Create an empty basket.
   *
   * :param book: the trip book that checks and prices each trip
   */
  constructor(book) {
    this.book = book;
    this.lines = [];
  }

  /**
   * Add a trip, or replace the basket's trip for the same departure in place.
   *
   * :param trip: tourId, date, time, adults, children and under4s
   * :return: errors, or a copy of the trip and whether it replaced one
   */
  add(trip) {
    const result = this.book.quote(trip);
    if (result.errors) return result;
    const index = this.indexOf(result.trip.tourId, result.trip.date, result.trip.time);
    if (index < 0 && this.lines.length >= TourData.MAX_TRIPS) {
      const message = `Your basket can hold up to ${TourData.MAX_TRIPS} trips. Reserve these first, or remove one.`;
      return { errors: { basket: message } };
    }
    if (index < 0) this.lines.push(result.trip);
    else this.lines[index] = result.trip;
    return {
      trip: TripBook.copyTrip(result.trip),
      replaced: index >= 0,
    };
  }

  /**
   * Take a departure's trip out of the basket.
   *
   * :param tourId: the tour
   * :param date: the date as "YYYY-MM-DD"
   * :param time: the time as "HH:MM"
   * :return: errors, or the removed trip
   */
  remove(tourId, date, time) {
    const index = this.indexOf(tourId, date, time);
    if (index < 0) return { errors: { basket: "That trip isn't in your basket." } };
    const removed = this.lines.splice(index, 1)[0];
    return { removed };
  }

  /**
   * List the trips in the basket.
   *
   * :return: copies of the trips, in the order they were added
   */
  trips() {
    const copies = [];
    for (const trip of this.lines) copies.push(TripBook.copyTrip(trip));
    return copies;
  }

  /**
   * Empty the basket.
   */
  clear() {
    this.lines = [];
  }

  /**
   * Find a departure's trip in the basket.
   *
   * :param tourId: the tour
   * :param date: the date as "YYYY-MM-DD"
   * :param time: the time as "HH:MM"
   * :return: the trip's index, or -1 when it isn't in the basket
   */
  indexOf(tourId, date, time) {
    for (let index = 0; index < this.lines.length; index += 1) {
      const trip = this.lines[index];
      if (trip.tourId === tourId && trip.date === date && trip.time === time) return index;
    }
    return -1;
  }
}

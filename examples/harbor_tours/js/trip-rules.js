import { Calendar } from "./calendar.js";
import { TourData } from "./tour-data.js";

/**
 * The tour company's booking rules and their messages for visitors. A check
 * returns a message, or an empty string when the input follows the rule. A
 * check that covers several form fields returns messages by field name.
 *
 * Contact details are checked without the spaces around them, the same way
 * the reservation form reads them.
 */
export class TripRules {
  /**
   * Check a trip date: a real date from tomorrow to BOOK_AHEAD_DAYS ahead.
   *
   * :param date: the date as "YYYY-MM-DD"
   * :return: a message, or an empty string when the date is fine
   */
  static dateProblem(date) {
    if (!Calendar.isDate(date)) return "Choose a date.";
    const today = Calendar.today();
    if (date < today) return "That date has passed. Choose a date from tomorrow.";
    if (date === today) {
      return "Online booking for today has closed. Ask at the ticket hut on Fish Quay for places on today's trips.";
    }
    if (Calendar.daysBetween(today, date) > TourData.BOOK_AHEAD_DAYS) {
      return `You can book up to ${TourData.BOOK_AHEAD_DAYS} days ahead online.`;
    }
    return "";
  }

  /**
   * Check a trip's tour, date and time: a real tour, a bookable date on which
   * it runs, and one of its times.
   *
   * :param tour: the trip's tour, or null when its tourId matches no tour
   * :param trip: tourId, date and time
   * :return: messages by field name
   */
  static departureErrors(tour, trip) {
    const errors = {};
    if (!tour) errors.tourId = "Choose a trip.";
    const dateProblem = TripRules.dateProblem(trip.date);
    if (dateProblem) {
      errors.date = dateProblem;
    } else if (tour && !tour.days.includes(Calendar.toDate(trip.date).getUTCDay())) {
      errors.date = `The ${tour.name} runs ${Calendar.describeDays(tour.days)}.`;
    }
    if (tour && !tour.times.includes(trip.time)) {
      errors.time = `The ${tour.name} runs at ${Calendar.describeTimes(tour.times)}.`;
    }
    return errors;
  }

  /**
   * Check a party's ticket numbers, in the order the messages are listed.
   *
   * :param party: adults, children and under4s
   * :return: a message for the tickets, or an empty string when they are fine
   */
  static partyProblem(party) {
    const given = party || {};
    const counts = [given.adults, given.children, given.under4s];
    // A count sent as text, such as "2", gets this message too.
    for (const count of counts) {
      if (!Number.isInteger(count)) return "Ticket numbers must be whole numbers, such as 2.";
    }
    for (const count of counts) {
      if (count < 0) return "Ticket numbers can't be less than 0.";
    }
    if (given.adults === 0 && given.children + given.under4s > 0) return "Children under 16 must come with an adult.";
    if (given.adults + given.children + given.under4s === 0) return "Choose at least 1 ticket.";
    if (given.under4s > given.adults) return "Book at least one adult ticket for each child under 4.";
    if (given.adults + given.children > TourData.MAX_PLACES) {
      return `You can book up to ${TourData.MAX_PLACES} places on one trip online. `
        + `For groups of ${TourData.MAX_PLACES + 1} or more, call us on 555-0162.`;
    }
    return "";
  }

  /**
   * Check that a party fits a departure: its age limit, then its places left.
   *
   * :param tour: the tour
   * :param party: adults, children and under4s, following the party rules
   * :param placesLeft: the places left on the departure
   * :return: a message, or an empty string when the party fits
   */
  static fitProblem(tour, party, placesLeft) {
    return TripRules.ageProblem(tour, party) || TripRules.placesProblem(party.adults + party.children, placesLeft);
  }

  /**
   * Check that a tour with a minimum age gets no children under 4.
   *
   * :param tour: the tour
   * :param party: adults, children and under4s
   * :return: a message, or an empty string when the ages are fine
   */
  static ageProblem(tour, party) {
    if (party.under4s > 0 && tour.minAge > 0) return `The ${tour.name} is for ages ${tour.minAge} and over.`;
    return "";
  }

  /**
   * Check that a departure has the places a party needs.
   *
   * :param needed: the places the party takes
   * :param placesLeft: the places left on the departure
   * :return: a message, or an empty string when there is room
   */
  static placesProblem(needed, placesLeft) {
    if (needed <= placesLeft) return "";
    if (placesLeft <= 0) return "This trip is full.";
    if (placesLeft === 1) return "Only 1 place is left on this trip.";
    return `Only ${placesLeft} places are left on this trip.`;
  }

  /**
   * Check the contact details. The phone is required, for weather calls.
   *
   * :param contact: first name, last name, email, phone and notes
   * :return: messages by field name
   */
  static contactErrors(contact) {
    const details = TripRules.cleanContact(contact);
    const errors = {};
    if (!details.firstName) errors.firstName = "Enter your first name.";
    if (!details.lastName) errors.lastName = "Enter your last name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) {
      errors.email = "Enter a valid email address, like name@example.com.";
    }
    // Allow common phone punctuation, but ask for at least 7 digits.
    const phone = details.phone;
    if (!/^[\d\s()+.-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7) {
      errors.phone = "Enter a phone number with at least 7 digits, "
        + "so we can reach you if the weather cancels your trip.";
    }
    if (details.notes.length > 300) errors.notes = "Keep notes to 300 characters.";
    return errors;
  }

  /**
   * Copy contact details without the spaces around each value, as the
   * reservation form reads them.
   *
   * :param contact: first name, last name, email, phone and notes
   * :return: the copy, with an empty string for each missing value
   */
  static cleanContact(contact) {
    const given = contact || {};
    return {
      firstName: TripRules.text(given.firstName),
      lastName: TripRules.text(given.lastName),
      email: TripRules.text(given.email),
      phone: TripRules.text(given.phone),
      notes: TripRules.text(given.notes),
    };
  }

  /**
   * Turn a value into text without surrounding spaces. A number becomes
   * text, and any other value that isn't a string becomes empty.
   *
   * :param value: the value
   * :return: the text
   */
  static text(value) {
    if (typeof value === "number") return String(value);
    return typeof value === "string" ? value.trim() : "";
  }
}

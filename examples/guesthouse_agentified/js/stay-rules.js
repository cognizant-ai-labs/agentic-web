import { Calendar } from "./calendar.js";
import { GuesthouseData } from "./guesthouse-data.js";

/**
 * The guesthouse's booking rules. Each check returns an object that maps a
 * form field name to a message for the guest. An empty object means the input
 * follows the rules.
 *
 * Guest details are checked without the spaces around them, the same way the
 * booking form reads them.
 */
export class StayRules {
  /**
   * Check a stay's dates, guests and extras. Without a room, guests are
   * checked against the largest room.
   *
   * :param stay: check-in, check-out, guests and extra ids
   * :param room: the chosen room, or null when searching every room
   * :return: messages by field name
   */
  static checkStay(stay, room) {
    const errors = {};
    if (!Calendar.isDate(stay.checkIn)) {
      errors.checkIn = "Choose a check-in date.";
    } else if (stay.checkIn < Calendar.today()) {
      errors.checkIn = "Check-in can't be in the past.";
    }
    const checkOutProblem = StayRules.checkOutProblem(stay.checkIn, stay.checkOut);
    if (checkOutProblem) errors.checkOut = checkOutProblem;
    let maxGuests = 0;
    for (const option of room ? [room] : GuesthouseData.ROOMS) {
      maxGuests = Math.max(maxGuests, option.maxGuests);
    }
    // A count sent as text, such as "2", gets its own message.
    if (!Number.isInteger(stay.guests)) {
      errors.guests = "The number of guests must be a whole number, such as 2.";
    } else if (stay.guests < 1) {
      errors.guests = "Choose at least 1 guest.";
    } else if (stay.guests > maxGuests) {
      const rooms = room ? `The ${room.name}` : "Our largest room";
      errors.guests = `${rooms} sleeps up to ${maxGuests} guests.`;
    }
    const extrasProblem = StayRules.extrasProblem(stay.extras || []);
    if (extrasProblem) errors.extras = extrasProblem;
    return errors;
  }

  /**
   * Check that the extras are a list of extras we offer, each chosen once.
   *
   * :param extras: the extra ids
   * :return: a message, or an empty string when the extras are fine
   */
  static extrasProblem(extras) {
    if (!Array.isArray(extras)) return "Extras must be a list of extra ids.";
    const seen = [];
    const unknown = [];
    const repeated = [];
    for (const id of extras) {
      const name = `"${id}"`;
      const offered = GuesthouseData.findById(GuesthouseData.EXTRAS, id) !== null;
      // Name each id once, even when it is listed several times.
      if (!offered && !unknown.includes(name)) unknown.push(name);
      if (offered && seen.includes(id) && !repeated.includes(name)) repeated.push(name);
      seen.push(id);
    }
    if (unknown.length === 1) return `We don't offer the extra ${unknown[0]}.`;
    if (unknown.length > 1) return `We don't offer the extras ${unknown.join(", ")}.`;
    if (repeated.length > 0) return `Choose each extra only once: ${repeated.join(", ")}.`;
    return "";
  }

  /**
   * Check the check-out date and the stay's length: check-out after check-in,
   * the Saturday minimum and the online maximum.
   *
   * :param checkIn: the arrival date
   * :param checkOut: the departure date
   * :return: a message, or an empty string when check-out is fine
   */
  static checkOutProblem(checkIn, checkOut) {
    if (!Calendar.isDate(checkOut)) return "Choose a check-out date.";
    // A bad check-in date gets its own message.
    if (!Calendar.isDate(checkIn)) return "";
    const count = Calendar.daysBetween(checkIn, checkOut);
    if (count < 1) return "Check-out must be after check-in.";
    if (count > GuesthouseData.MAX_NIGHTS) {
      return `You can book up to ${GuesthouseData.MAX_NIGHTS} nights online. Call us for longer stays.`;
    }
    for (let night = checkIn; night < checkOut; night = Calendar.addDays(night, 1)) {
      // Day 6 is Saturday.
      if (Calendar.toDate(night).getUTCDay() === 6 && count < GuesthouseData.SATURDAY_MIN_NIGHTS) {
        return `Stays that include a Saturday night need at least ${GuesthouseData.SATURDAY_MIN_NIGHTS} nights.`;
      }
    }
    return "";
  }

  /**
   * Check the guest details for a booking, without the spaces around each
   * value. The phone number is optional.
   *
   * :param guest: first name, last name, email, phone, arrival and requests
   * :return: messages by field name
   */
  static checkGuest(guest) {
    const details = StayRules.cleanGuest(guest);
    const errors = {};
    if (!details.firstName) errors.firstName = "Enter your first name.";
    if (!details.lastName) errors.lastName = "Enter your last name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) {
      errors.email = "Enter a valid email address, like name@example.com.";
    }
    // Allow common phone punctuation, but ask for at least 7 digits.
    const phone = details.phone;
    if (phone && (!/^[\d\s()+.-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7)) {
      errors.phone = "Enter a phone number with at least 7 digits, or leave it blank.";
    }
    if (!GuesthouseData.ARRIVAL_TIMES.includes(details.arrival)) {
      errors.arrival = "Choose roughly when you'll arrive.";
    }
    if (details.requests.length > 500) errors.requests = "Keep special requests to 500 characters.";
    return errors;
  }

  /**
   * Copy a guest's details without the spaces around each value, as the
   * booking form reads them.
   *
   * :param guest: first name, last name, email, phone, arrival and requests
   * :return: the copy, with an empty string for each missing value
   */
  static cleanGuest(guest) {
    const given = guest || {};
    return {
      firstName: StayRules.text(given.firstName),
      lastName: StayRules.text(given.lastName),
      email: StayRules.text(given.email),
      phone: StayRules.text(given.phone),
      arrival: StayRules.text(given.arrival),
      requests: StayRules.text(given.requests),
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

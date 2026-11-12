import { Calendar } from "./calendar.js";
import { GuesthouseData } from "./guesthouse-data.js";
import { PriceCalculator } from "./price-calculator.js";
import { StayRules } from "./stay-rules.js";

/**
 * Keeps the guesthouse's bookings in memory and runs the booking operations:
 * search, quote, place, look up and cancel.
 *
 * Each operation returns an object. When the input breaks a rule, it holds
 * only errors, which maps form field names to messages. Reloading the page
 * starts again from the existing bookings in GuesthouseData.
 */
export class ReservationBook {
  /**
   * Create the book with the existing bookings, dated from today.
   */
  constructor() {
    this.bookings = [];
    for (const existing of GuesthouseData.EXISTING_BOOKINGS) {
      const checkIn = Calendar.addDays(Calendar.today(), existing.daysFromToday);
      const stay = {
        roomId: existing.roomId,
        checkIn: checkIn,
        checkOut: Calendar.addDays(checkIn, existing.nights),
        guests: existing.guests,
        extras: [],
      };
      const guest = {
        firstName: existing.firstName,
        lastName: existing.lastName,
      };
      this.bookings.push(ReservationBook.record(existing.code, stay, guest));
    }
  }

  /**
   * Build a confirmed booking with its price.
   *
   * :param code: the confirmation code
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :param guest: the guest's details
   * :return: the booking
   */
  static record(code, stay, guest) {
    return {
      code: code,
      status: "confirmed",
      stay: stay,
      guest: guest,
      quote: PriceCalculator.quote(GuesthouseData.findById(GuesthouseData.ROOMS, stay.roomId), stay),
      cancellationFee: 0,
    };
  }

  /**
   * Check that no confirmed booking for a room overlaps a stay.
   *
   * :param roomId: the room
   * :param checkIn: the arrival date
   * :param checkOut: the departure date
   * :return: true when the room is free every night of the stay
   */
  isFree(roomId, checkIn, checkOut) {
    for (const booking of this.bookings) {
      const other = booking.stay;
      // Stays may touch: a guest can arrive on the day another leaves.
      if (booking.status === "confirmed" && other.roomId === roomId
        && other.checkIn < checkOut && checkIn < other.checkOut) {
        return false;
      }
    }
    return true;
  }

  /**
   * Search availability: list the rooms that fit the guests and are free for
   * the whole stay, each priced without extras.
   *
   * :param checkIn: the arrival date as "YYYY-MM-DD"
   * :param checkOut: the departure date as "YYYY-MM-DD"
   * :param guests: the number of guests
   * :return: errors, or rooms as a list of { room, quote }
   */
  search(checkIn, checkOut, guests) {
    const stay = {
      checkIn: checkIn,
      checkOut: checkOut,
      guests: guests,
      extras: [],
    };
    const errors = StayRules.checkStay(stay, null);
    if (Object.keys(errors).length > 0) return { errors };
    const rooms = [];
    for (const room of GuesthouseData.ROOMS) {
      if (guests <= room.maxGuests && this.isFree(room.id, checkIn, checkOut)) {
        rooms.push({
          room: room,
          quote: PriceCalculator.quote(room, stay),
        });
      }
    }
    return { rooms };
  }

  /**
   * Price a stay in one room with extras, if it follows the rules and the
   * room is free.
   *
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :return: errors, or the itemized quote
   */
  quote(stay) {
    const draft = ReservationBook.copyStay(stay);
    const room = GuesthouseData.findById(GuesthouseData.ROOMS, draft.roomId);
    // Start with the room so its message comes first.
    const errors = room ? {} : { roomId: "Choose a room." };
    Object.assign(errors, StayRules.checkStay(draft, room));
    if (room && Object.keys(errors).length === 0 && !this.isFree(room.id, draft.checkIn, draft.checkOut)) {
      errors.roomId = `The ${room.name} is already booked on some of those nights.`;
    }
    if (Object.keys(errors).length > 0) return { errors };
    return { quote: PriceCalculator.quote(room, draft) };
  }

  /**
   * Check a booking without placing it or changing anything: every stay rule,
   * a free room and the guest's details. place() runs this same check first.
   *
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :param guest: first name, last name, email, phone, arrival and requests
   * :return: errors, or the stay, the guest's details and the quote that place() would store
   */
  checkPlace(stay, guest) {
    const draft = ReservationBook.copyStay(stay);
    const details = StayRules.cleanGuest(guest);
    const priced = this.quote(draft);
    const errors = Object.assign({}, priced.errors, StayRules.checkGuest(details));
    if (Object.keys(errors).length > 0) return { errors };
    return {
      stay: draft,
      guest: details,
      quote: priced.quote,
    };
  }

  /**
   * Place a booking. No payment is taken: guests pay at the guesthouse.
   * The guest's details are stored without the spaces around them.
   *
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :param guest: first name, last name, email, phone, arrival and requests
   * :return: errors, or the new booking with its confirmation code
   */
  place(stay, guest) {
    const checked = this.checkPlace(stay, guest);
    if (checked.errors) return checked;
    // Store the copies, so later changes to the caller's objects can't alter the booking.
    const booking = ReservationBook.record(this.newCode(), checked.stay, checked.guest);
    this.bookings.push(booking);
    return { booking };
  }

  /**
   * Copy a stay's room, dates, guests and extras. Missing extras mean none.
   *
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :return: the copy
   */
  static copyStay(stay) {
    const given = stay || {};
    const extras = given.extras || [];
    return {
      roomId: given.roomId,
      checkIn: given.checkIn,
      checkOut: given.checkOut,
      guests: given.guests,
      // Keep extras that aren't a list as they are, so the rules can reject them.
      extras: Array.isArray(extras) ? extras.slice() : extras,
    };
  }

  /**
   * Look up a booking by confirmation code and last name. Both are required.
   *
   * :param code: the confirmation code, in any letter case
   * :param lastName: the last name on the booking, in any letter case
   * :return: errors, or the booking and what cancelling it today would cost
   */
  lookUp(code, lastName) {
    const wantedCode = String(code || "").trim().toUpperCase();
    const wantedName = String(lastName || "").trim().toLowerCase();
    const errors = {};
    if (!wantedCode) errors.code = "Enter your confirmation code.";
    if (!wantedName) errors.lastName = "Enter the last name on the booking.";
    if (Object.keys(errors).length > 0) return { errors };
    for (const booking of this.bookings) {
      if (booking.code === wantedCode && booking.guest.lastName.toLowerCase() === wantedName) {
        return {
          booking: booking,
          cancellation: ReservationBook.cancellationTerms(booking),
        };
      }
    }
    return { errors: { code: "We couldn't find a booking with that code and last name." } };
  }

  /**
   * Check a cancellation without making it or changing anything. cancel()
   * runs this same check first.
   *
   * :param code: the confirmation code
   * :param lastName: the last name on the booking
   * :param expectedFee: the fee in cents the guest was shown, from lookUp
   * :return: errors, or the booking and the fee and rule that cancel() would apply
   */
  checkCancel(code, lastName, expectedFee) {
    const found = this.lookUp(code, lastName);
    if (found.errors) return found;
    if (found.booking.status === "cancelled") return { errors: { code: "This booking is already cancelled." } };
    if (!found.cancellation) {
      return { errors: { code: "This stay has already started. Please talk to us at the guesthouse." } };
    }
    // The fee goes up as check-in gets closer, so a fee shown yesterday may be wrong today.
    if (found.cancellation.fee !== expectedFee) {
      return { errors: { code: "The cancellation fee has changed. Look up the booking again to see today's fee." } };
    }
    return found;
  }

  /**
   * Cancel a booking found by confirmation code and last name. The fee follows
   * the cancellation policy on policies.html. The cancellation is refused when
   * today's fee is not the fee the guest was shown.
   *
   * :param code: the confirmation code
   * :param lastName: the last name on the booking
   * :param expectedFee: the fee in cents the guest was shown, from lookUp
   * :return: errors, or the cancelled booking and the fee and rule applied
   */
  cancel(code, lastName, expectedFee) {
    const found = this.checkCancel(code, lastName, expectedFee);
    if (found.errors) return found;
    found.booking.status = "cancelled";
    found.booking.cancellationFee = found.cancellation.fee;
    return found;
  }

  /**
   * Apply the cancellation policy to a booking as of today.
   *
   * :param booking: the booking
   * :return: the fee in cents and the rule, or null if it can't be cancelled online
   */
  static cancellationTerms(booking) {
    const daysAhead = Calendar.daysBetween(Calendar.today(), booking.stay.checkIn);
    // No tier matches a cancelled booking or a stay that has started.
    for (const tier of GuesthouseData.CANCELLATION_TIERS) {
      if (booking.status === "confirmed" && daysAhead >= tier.minDays) {
        return {
          fee: Math.round(booking.quote.roomCharge * tier.feeShare),
          rule: tier.rule,
        };
      }
    }
    return null;
  }

  /**
   * Make a confirmation code that no other booking uses.
   *
   * :return: a code such as "TW-7KQ2"
   */
  newCode() {
    // Leave out 0, O, 1 and I, which are easy to mix up.
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "TW-";
    while (code.length < 7) code += letters[Math.floor(Math.random() * letters.length)];
    for (const booking of this.bookings) {
      if (booking.code === code) return this.newCode();
    }
    return code;
  }
}

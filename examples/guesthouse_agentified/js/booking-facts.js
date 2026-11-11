import { Calendar } from "./calendar.js";
import { GuesthouseData } from "./guesthouse-data.js";
import { PriceCalculator } from "./price-calculator.js";

/**
 * Describes the guesthouse's rooms, prices and bookings as plain JSON, using
 * the same words, dates and amounts that the page shows.
 *
 * The page renders some of this text, and the assistant reads the rest, so
 * both always say the same thing.
 */
export class BookingFacts {
  /**
   * Collapse the spaces and line breaks in a piece of page text.
   *
   * :param text: the text, or null
   * :return: the text on one line, without surrounding spaces
   */
  static plain(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  /**
   * Give a date with its weekday, such as "Wed, Nov 11, 2026".
   *
   * :param iso: the date as "YYYY-MM-DD"
   * :return: the date and its weekday
   */
  static day(iso) {
    return {
      date: iso,
      day: Calendar.format(iso),
    };
  }

  /**
   * Describe a stay's dates and length, such as
   * "Wed, Dec 2, 2026 to Fri, Dec 4, 2026 (2 nights)".
   *
   * :param stay: check-in and check-out
   * :param nights: the number of nights
   * :return: the dates with weekdays and the nights
   */
  static dates(stay, nights) {
    return `${Calendar.format(stay.checkIn)} to ${Calendar.format(stay.checkOut)} (${PriceCalculator.count(nights, "night")})`;
  }

  /**
   * Describe a room's rates as the room card shows them.
   *
   * :param room: the room
   * :return: the weeknight and weekend rates
   */
  static rates(room) {
    return `${PriceCalculator.money(room.nightlyRate)} a night, `
      + `${PriceCalculator.money(room.weekendRate)} on Friday and Saturday nights`;
  }

  /**
   * Say whether dogs may stay in a room, as the room card does.
   *
   * :param room: the room
   * :return: the pet note
   */
  static pets(room) {
    return room.petFriendly ? "Dogs welcome." : "No pets, but assistance dogs are welcome.";
  }

  /**
   * Describe an extra with its price, as the booking form does.
   *
   * :param extra: the extra
   * :return: the extra's name and price
   */
  static extraLabel(extra) {
    return `${extra.name}, ${PriceCalculator.money(extra.price)} per ${extra.per}`;
  }

  /**
   * Describe a search result's price, as the search results show it.
   *
   * :param quote: the room's quote
   * :return: the nights and total
   */
  static searchPrice(quote) {
    return `${PriceCalculator.count(quote.nights, "night")}: `
      + `${PriceCalculator.money(quote.total)} with the cleaning fee and tourist tax`;
  }

  /**
   * List every room with its beds, guest limit, rates, amenities, access and pets.
   *
   * :return: the rooms
   */
  static rooms() {
    const rooms = [];
    for (const room of GuesthouseData.ROOMS) {
      rooms.push({
        id: room.id,
        name: room.name,
        beds: room.beds,
        sleeps: room.maxGuests,
        rates: BookingFacts.rates(room),
        amenities: room.amenities.slice(),
        access: room.accessibility,
        pets: BookingFacts.pets(room),
      });
    }
    return rooms;
  }

  /**
   * List the extras guests can add, with their prices.
   *
   * :return: the extras
   */
  static extras() {
    const extras = [];
    for (const extra of GuesthouseData.EXTRAS) {
      extras.push({
        id: extra.id,
        name: extra.name,
        price: `${PriceCalculator.money(extra.price)} per ${extra.per}`,
      });
    }
    return extras;
  }

  /**
   * Describe the fees, stay limits, arrival times and cancellation tiers.
   *
   * :return: the house terms
   */
  static terms() {
    const cancellation = [];
    for (const tier of GuesthouseData.CANCELLATION_TIERS) {
      cancellation.push(tier.rule);
    }
    return {
      cleaningFee: `${PriceCalculator.money(GuesthouseData.CLEANING_FEE)} per stay`,
      touristTax: `${PriceCalculator.money(GuesthouseData.TOURIST_TAX)} per guest per night`,
      saturdayMinimumNights: GuesthouseData.SATURDAY_MIN_NIGHTS,
      longestOnlineStayNights: GuesthouseData.MAX_NIGHTS,
      arrivalTimes: GuesthouseData.ARRIVAL_TIMES.slice(),
      cancellationFees: cancellation,
    };
  }

  /**
   * Name the extras in a list of extra ids.
   *
   * :param ids: the extra ids
   * :return: the extras' names
   */
  static extraNames(ids) {
    const names = [];
    for (const id of ids) {
      names.push(GuesthouseData.findById(GuesthouseData.EXTRAS, id).name);
    }
    return names;
  }

  /**
   * Give the rows of a booking summary: guest, room, dates, guests, extras and
   * total. The page shows these rows, and the assistant reads them.
   *
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :param guest: the guest's details
   * :param quote: the stay's quote
   * :return: a list of [label, text] pairs
   */
  static summaryRows(stay, guest, quote) {
    return [
      ["Guest", `${guest.firstName} ${guest.lastName}`],
      ["Room", GuesthouseData.findById(GuesthouseData.ROOMS, stay.roomId).name],
      ["Dates", BookingFacts.dates(stay, quote.nights)],
      ["Guests", String(stay.guests)],
      ["Extras", BookingFacts.extraNames(stay.extras).join(", ") || "None"],
      ["Total", `${PriceCalculator.money(quote.total)}, paid at the guesthouse`],
    ];
  }

  /**
   * Describe a booking as the page's summary does, with its code, status and
   * dates. It leaves out the email, phone, arrival and requests, which the page
   * does not show either.
   *
   * :param booking: the booking
   * :return: the booking as plain JSON
   */
  static booking(booking) {
    const described = {
      code: booking.code,
      status: booking.status,
      roomId: booking.stay.roomId,
      checkIn: booking.stay.checkIn,
      checkOut: booking.stay.checkOut,
    };
    for (const row of BookingFacts.summaryRows(booking.stay, booking.guest, booking.quote)) {
      described[row[0].toLowerCase()] = row[1];
    }
    if (booking.status === "cancelled") {
      described.cancellationFee = PriceCalculator.money(booking.cancellationFee);
    }
    return described;
  }

  /**
   * Describe a priced stay line by line, with the dates and amounts the page shows.
   *
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :param quote: the stay's quote
   * :return: the stay and its price
   */
  static pricedStay(stay, quote) {
    const lines = [];
    for (const line of quote.lines) {
      lines.push({
        item: line.label,
        detail: line.detail,
        amount: PriceCalculator.money(line.amount),
      });
    }
    return {
      roomId: stay.roomId,
      room: GuesthouseData.findById(GuesthouseData.ROOMS, stay.roomId).name,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      dates: BookingFacts.dates(stay, quote.nights),
      guests: stay.guests,
      extras: BookingFacts.extraNames(stay.extras),
      lines: lines,
      total: PriceCalculator.money(quote.total),
    };
  }

  /**
   * Describe the guest's details for a booking that is about to be placed.
   *
   * :param guest: the guest's details, without surrounding spaces
   * :return: the details, with "None" for those left blank
   */
  static guest(guest) {
    return {
      name: `${guest.firstName} ${guest.lastName}`,
      email: guest.email,
      phone: guest.phone || "None",
      arrival: guest.arrival,
      requests: guest.requests || "None",
    };
  }

  /**
   * Give the note the booking panel shows under a booking: what cancelling it
   * today costs, its cancellation fee, or that it can't be cancelled online.
   *
   * :param booking: the booking
   * :param terms: the fee in cents and the rule, or null when it can't be cancelled online
   * :return: the note
   */
  static bookingNote(booking, terms) {
    const fee = booking.cancellationFee;
    if (booking.status === "cancelled") {
      return fee > 0
        ? `Cancelled. We'll email you an invoice for the ${PriceCalculator.money(fee)} cancellation fee.`
        : "Cancelled free of charge.";
    }
    if (terms) {
      return `If you cancel today: ${terms.fee > 0 ? PriceCalculator.money(terms.fee) : "no charge"} (${terms.rule}).`;
    }
    return "This stay has started, so it can't be cancelled online. Please talk to us at the guesthouse.";
  }

  /**
   * Describe what cancelling a booking today would cost.
   *
   * :param terms: the fee in cents and the rule, or null when it can't be cancelled online
   * :return: the fee as the page shows it and in cents, and the rule, or null
   */
  static cancellation(terms) {
    if (!terms) {
      return null;
    }
    return {
      fee: terms.fee > 0 ? PriceCalculator.money(terms.fee) : "no charge",
      feeCents: terms.fee,
      rule: terms.rule,
    };
  }
}

import { Calendar } from "./calendar.js";
import { GuesthouseData } from "./guesthouse-data.js";

/**
 * Prices a stay as itemized lines: room nights, extras, the cleaning fee and
 * the tourist tax. Amounts are whole US cents.
 */
export class PriceCalculator {
  /** Formats dollar amounts such as "$145.00". */
  static DOLLARS = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  /**
   * Price a stay in a room. The stay must already follow the booking rules.
   *
   * :param room: the room
   * :param stay: check-in, check-out, guests and extra ids
   * :return: nights, weekend nights, room charge, itemized lines and total
   */
  static quote(room, stay) {
    let nights = 0;
    let weekendNights = 0;
    for (let night = stay.checkIn; night < stay.checkOut; night = Calendar.addDays(night, 1)) {
      nights += 1;
      // Friday (5) and Saturday (6) nights use the weekend rate.
      if (Calendar.toDate(night).getUTCDay() >= 5) weekendNights += 1;
    }
    const weeknights = nights - weekendNights;
    const lines = [];
    if (weeknights > 0) {
      lines.push(PriceCalculator.line("Weeknights", "night", room.nightlyRate, weeknights, 0));
    }
    if (weekendNights > 0) {
      lines.push(PriceCalculator.line("Weekend nights", "night", room.weekendRate, weekendNights, 0));
    }
    for (const extra of GuesthouseData.EXTRAS) {
      if (stay.extras.includes(extra.id)) {
        lines.push(PriceCalculator.line(extra.name, extra.per, extra.price, nights, stay.guests));
      }
    }
    lines.push(PriceCalculator.line("Cleaning fee", "stay", GuesthouseData.CLEANING_FEE, nights, stay.guests));
    lines.push(PriceCalculator.line("Tourist tax", "guest per night", GuesthouseData.TOURIST_TAX, nights, stay.guests));
    let total = 0;
    for (const line of lines) total += line.amount;
    return {
      nights: nights,
      weekendNights: weekendNights,
      roomCharge: weeknights * room.nightlyRate + weekendNights * room.weekendRate,
      lines: lines,
      total: total,
    };
  }

  /**
   * Price one line of a quote, with a detail such as "2 guests × 3 nights × $14.00".
   *
   * :param label: what the line is for
   * :param per: "guest per night", "night" or "stay"
   * :param price: the price per unit in cents
   * :param nights: the nights the line covers
   * :param guests: the number of guests
   * :return: the line's label, detail and amount
   */
  static line(label, per, price, nights, guests) {
    const each = PriceCalculator.money(price);
    let units = 1;
    let detail = "per stay";
    if (per === "night") {
      units = nights;
      detail = `${PriceCalculator.count(nights, "night")} × ${each}`;
    } else if (per === "guest per night") {
      units = guests * nights;
      detail = `${PriceCalculator.count(guests, "guest")} × ${PriceCalculator.count(nights, "night")} × ${each}`;
    }
    return {
      label: label,
      detail: detail,
      amount: units * price,
    };
  }

  /**
   * Write a number with its noun, such as "1 night" or "3 nights".
   *
   * :param count: the number
   * :param noun: the singular noun
   * :return: the number and noun
   */
  static count(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  /**
   * Format cents as US dollars, such as "$145.00".
   *
   * :param cents: the amount in cents
   * :return: the formatted amount
   */
  static money(cents) {
    return PriceCalculator.DOLLARS.format(cents / 100);
  }
}

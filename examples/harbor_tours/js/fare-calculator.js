import { TourData } from "./tour-data.js";

/**
 * Prices one trip as itemized lines: adult and child tickets, free tickets
 * for children under 4, and the harbor dues on boat trips. Amounts are whole
 * US cents. It also writes money, counts and parties as text.
 */
export class FareCalculator {
  /** Formats dollar amounts such as "$38.00". */
  static DOLLARS = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  /**
   * Price a party on a tour. The party must already follow the rules.
   *
   * :param tour: the tour
   * :param party: adults, children and under4s
   * :return: the places the party takes, the itemized lines and the total
   */
  static quote(tour, party) {
    const places = party.adults + party.children;
    const lines = [];
    if (party.adults > 0) lines.push(FareCalculator.line("Adults", party.adults, "ticket", tour.adultPrice));
    if (party.children > 0) lines.push(FareCalculator.line("Children", party.children, "ticket", tour.childPrice));
    if (party.under4s > 0) {
      lines.push({
        label: "Children under 4",
        detail: `${FareCalculator.count(party.under4s, "ticket")}, free`,
        amount: 0,
      });
    }
    // The dues are per passenger aged 4 and over, which is everyone who takes a place.
    if (tour.kind === "boat" && places > 0) {
      lines.push(FareCalculator.line("Harbor dues", places, "passenger", TourData.HARBOR_DUES));
    }
    let total = 0;
    for (const line of lines) total += line.amount;
    return {
      places: places,
      lines: lines,
      total: total,
    };
  }

  /**
   * Price one line of a quote, with a detail such as "2 tickets × $38.00".
   *
   * :param label: what the line is for
   * :param units: how many tickets or passengers the line covers
   * :param noun: the name of one unit, such as "ticket"
   * :param price: the price per unit in cents
   * :return: the line's label, detail and amount
   */
  static line(label, units, noun, price) {
    return {
      label: label,
      detail: `${FareCalculator.count(units, noun)} × ${FareCalculator.money(price)}`,
      amount: units * price,
    };
  }

  /**
   * Describe a party, such as "2 adults, 1 child", leaving out counts of 0.
   *
   * :param party: adults, children and under4s
   * :return: the description
   */
  static partyText(party) {
    const parts = [];
    if (party.adults > 0) parts.push(FareCalculator.count(party.adults, "adult"));
    if (party.children > 0) parts.push(FareCalculator.count(party.children, "child", "children"));
    if (party.under4s > 0) parts.push(FareCalculator.count(party.under4s, "child under 4", "children under 4"));
    return parts.join(", ");
  }

  /**
   * Write a number with its noun, such as "1 child" or "2 children".
   *
   * :param count: the number
   * :param singular: the noun for one
   * :param plural: the noun for other numbers, or nothing to add "s" to singular
   * :return: the number and noun
   */
  static count(count, singular, plural) {
    const noun = count === 1 ? singular : plural || `${singular}s`;
    return `${count} ${noun}`;
  }

  /**
   * Format cents as US dollars, such as "$38.00".
   *
   * :param cents: the amount in cents
   * :return: the formatted amount
   */
  static money(cents) {
    return FareCalculator.DOLLARS.format(cents / 100);
  }
}

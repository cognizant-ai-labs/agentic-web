import { Calendar } from "./calendar.js";
import { FareCalculator } from "./fare-calculator.js";

/**
 * Words a tour's facts in the same text everywhere: on its trip card, in the assistant's
 * state reader and in the facts other agent sites read.
 *
 * It loads without a page, so the build can run it in Node for agent-facts.mjs.
 */
export class TourFacts {
  /**
   * Write a tour's facts as the page shows them on its card.
   *
   * :param tour: the tour
   * :return: how it travels, its prices, days and times, ages and dogs, as text
   */
  static tourText(tour) {
    // A tour with a minimum age takes no children under 4, so it has no free tickets.
    const under4s = tour.minAge > 0 ? "" : ", under 4s free";
    return {
      travel: tour.vessel ? `on the ${tour.vessel}` : "on foot",
      prices: `Adults ${FareCalculator.money(tour.adultPrice)}, `
        + `children ${FareCalculator.money(tour.childPrice)}${under4s}.`,
      runs: `Runs ${Calendar.describeDays(tour.days)} at ${Calendar.describeTimes(tour.times)}.`,
      ages: tour.minAge > 0 ? `Ages ${tour.minAge} and over.` : "All ages.",
      dogs: tour.dogsWelcome ? "Dogs on a lead welcome." : "No dogs, but assistance dogs are welcome.",
    };
  }

  /**
   * Write one line with everything a tour's card says, in the card's words.
   *
   * :param tour: the tour
   * :return: the line
   */
  static summary(tour) {
    const text = TourFacts.tourText(tour);
    return `${tour.name}: ${tour.minutes} minutes ${text.travel}. ${tour.places} places. `
      + `${text.runs} ${text.prices} ${tour.access} ${text.ages} ${text.dogs} `
      + `Highlights: ${tour.highlights.join(", ")}.`;
  }
}

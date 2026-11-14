// Public facts for other agent sites. The build runs this module in Node and writes
// facts/marrow_point_harbor_tours_facts.network.json from it. See "Facts for callers" in
// the skill's references/linking.md. It imports only data modules that load without a page.
import { TourData } from "./js/tour-data.js";
import { TourFacts } from "./js/tour-facts.js";

/**
 * Gives the facts that other sites' assistants may read about Marrow Point Harbor Tours.
 *
 * Every fact is the same for every visitor. The trips come from the site's data, in the
 * words the trip cards use. The rest is quoted from the page parts marked
 * data-agent-facts. Nothing here reads a reservation, so no visitor's details can reach
 * another site.
 */
export class AgentFacts {
  /**
   * The pages whose marked parts the build quotes, in this order.
   */
  static PAGES = [
    "index.html",
    "policies.html",
  ];

  /**
   * Describe each trip as its card does: length, places, days and times, prices, access,
   * ages, dogs and highlights.
   *
   * :return: One topic with a line per trip.
   */
  static dataFacts() {
    const lines = [];
    for (const tour of TourData.TOURS) {
      lines.push(TourFacts.summary(tour));
    }
    return [
      {
        title: "Trips",
        source: "js/tour-data.js",
        lines: lines,
      },
    ];
  }
}

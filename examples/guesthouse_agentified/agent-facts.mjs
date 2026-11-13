// Public facts for other agent sites. The build runs this module in Node and writes
// facts/tidewhistle_guesthouse_facts.network.json from it. See "Facts for callers" in the
// skill's references/linking.md. It imports only data modules that load without a page.
import { BookingFacts } from "./js/booking-facts.js";

/**
 * Gives the facts that other sites' assistants may read about Tidewhistle Guesthouse.
 *
 * Every fact is the same for every visitor. The rooms come from the site's data, in the
 * words the room cards use. The rest is quoted from the page parts marked
 * data-agent-facts. Nothing here reads a booking, so no guest's details can reach another
 * site.
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
   * Describe the rooms as the room cards do: beds, guests, rates, amenities, access and pets.
   *
   * :return: One topic with a line per room.
   */
  static dataFacts() {
    const lines = [];
    for (const room of BookingFacts.rooms()) {
      lines.push(`${room.name}: ${room.beds}, sleeps ${room.sleeps}. ${room.rates}. ${room.amenities.join(", ")}. ${room.access} ${room.pets}`);
    }
    return [
      {
        title: "Rooms",
        source: "js/guesthouse-data.js",
        lines: lines,
      },
    ];
  }
}

// Public facts for other agent sites, for scripts/facts_network.test.mjs.
import { DeskFacts } from "./js/desk-facts.js";

/**
 * Gives the test desk's facts: its opening hours from its data, and two marked pages.
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
   * Describe the opening hours as the page does.
   *
   * :return: One topic with a line per opening period.
   */
  static dataFacts() {
    return [
      {
        title: "Opening hours",
        source: "js/desk-data.js",
        lines: DeskFacts.hours(),
      },
    ];
  }
}

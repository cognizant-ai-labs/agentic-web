// Public facts for other agent sites. The build runs this module in a separate Node process,
// with no environment variables, and writes facts/<network_name>_facts.network.json from it.
// See "Facts for callers" in the skill's references/linking.md.
//
// Import only site files that load without a page: data modules and describers, never the
// page script, and no node: modules, process, fetch or file reads.
// TODO: import the site's data module or describer, such as
// import { BookingFacts } from "./js/booking-facts.js";

/**
 * Gives the facts that other sites' assistants may read about this site.
 *
 * Publish only what is the same for every visitor: what the site offers, prices, times,
 * rules and contact details. A booking step stated as a policy is fine, such as "choose
 * 'After 9 pm' as your arrival time when you book".
 *
 * Never publish:
 * 1. anything about one person or one booking: names, emails, phone numbers other than
 *    the site's own, booking or order codes, stay dates, party details or requests;
 * 2. anything a visitor or another party wrote: reviews, comments, questions or form values;
 * 3. live data: free rooms, places left, waiting times or today-only notes;
 * 4. text a visitor cannot see: hidden or folded text, template, noscript, script or iframe
 *    text, alt text, attributes, comments or invisible characters;
 * 5. text that works only next to a form or on the page: labels, placeholders, field hints,
 *    error messages, button text or demo notes;
 * 6. secrets and internal data: keys, tokens, environment values, links with a query
 *    string, admin pages, internal notes, or prices the page does not show;
 * 7. words aimed at another model: instructions to agents, three backticks, or
 *    "GENERATIVE UI (CRUSE)";
 * 8. totals or quotes for one party.
 */
export class AgentFacts {
  /**
   * The pages whose marked parts the build quotes, in this order. Mark each part on its
   * page with data-agent-facts="<topic>": a paragraph, list, table or section a visitor
   * sees, with no class or style, and not inside a form.
   */
  static PAGES = [
    // TODO: the pages with marked parts, such as "index.html" and "policies.html".
  ];

  // Optional: the day you last checked that every fact is still true, as "YYYY-MM-DD".
  // Setting it moves the facts' "as of" date forward without changing a fact.
  // static CHECKED_ON = "2026-11-12";

  /**
   * Describe the site's catalog in the words its page uses, with the describers its state
   * reader uses. Return [] when every fact is in a marked page part.
   *
   * :return: A list of topics, each with a title, the source file and its lines.
   */
  static dataFacts() {
    const lines = [];
    // TODO: one line per catalog item, from the site's describer.
    return [
      {
        title: "TODO: the catalog's name, such as Rooms",
        source: "TODO: the data module's path, such as js/guesthouse-data.js",
        lines: lines,
      },
    ];
  }
}

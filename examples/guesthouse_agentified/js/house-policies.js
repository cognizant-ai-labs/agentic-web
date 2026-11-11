import { BookingFacts } from "./booking-facts.js";

/**
 * Reads the house policies from policies.html, so the assistant answers from
 * the page guests read and no policy text is copied anywhere else.
 *
 * It needs a browser: it fetches the page and parses it with DOMParser.
 */
export class HousePolicies {
  /** The address of the policies page, next to index.html. */
  static PAGE = new URL("../policies.html", import.meta.url).href;

  /**
   * Fetch the policies page and return the text of each section.
   *
   * :return: the page address and its sections
   * :raises Error: when the page cannot be loaded
   */
  static async read() {
    const response = await fetch(HousePolicies.PAGE);
    if (!response.ok) {
      throw new Error(`The policies page could not be loaded (HTTP ${response.status}).`);
    }
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const sections = [];
    for (const section of page.querySelectorAll("main section")) {
      sections.push(HousePolicies.section(section));
    }
    return {
      page: HousePolicies.PAGE,
      sections: sections,
    };
  }

  /**
   * Describe one section: its heading, paragraphs and list items, table rows and links.
   *
   * :param section: the section element
   * :return: the section's id, title, text, tables and links
   */
  static section(section) {
    const heading = section.querySelector("h1, h2");
    const text = [];
    for (const item of section.querySelectorAll("h3, p, li")) {
      text.push(BookingFacts.plain(item.textContent));
    }
    const tables = [];
    for (const table of section.querySelectorAll("table")) {
      tables.push(HousePolicies.rows(table));
    }
    const links = [];
    for (const link of section.querySelectorAll("a[href]")) {
      // Resolve against the policies page, so each link works from any page.
      links.push({
        text: BookingFacts.plain(link.textContent),
        href: new URL(link.getAttribute("href"), HousePolicies.PAGE).href,
      });
    }
    return {
      id: section.id || "introduction",
      title: heading ? BookingFacts.plain(heading.textContent) : "",
      text: text,
      tables: tables,
      links: links,
    };
  }

  /**
   * Read a table's rows as lists of cell text, header row first.
   *
   * :param table: the table element
   * :return: the rows
   */
  static rows(table) {
    const rows = [];
    for (const row of table.querySelectorAll("tr")) {
      const cells = [];
      for (const cell of row.querySelectorAll("th, td")) {
        cells.push(BookingFacts.plain(cell.textContent));
      }
      rows.push(cells);
    }
    return rows;
  }
}

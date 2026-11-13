/**
 * Reads the Good to know page, policies.html, as plain data for the assistant:
 * each section's heading, points, paragraphs, table rows and links. Policy
 * facts then come from the page itself, never from a copy.
 */
export class GoodToKnow {
  /**
   * Fetch the Good to know page and return its sections.
   *
   * :param url: the page's address
   * :return: the page's address and its sections
   * :raises Error: when there is no DOMParser, or the page cannot be read
   */
  static async read(url) {
    // Check first: Node has fetch but no DOMParser, so a test never sends a real request.
    if (typeof DOMParser === "undefined") throw new Error("Reading the Good to know page needs a browser.");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The Good to know page answered ${response.status}.`);
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const sections = [];
    for (const section of page.querySelectorAll("main section")) sections.push(GoodToKnow.section(section, url));
    return {
      page: url,
      sections: sections,
    };
  }

  /**
   * Describe one section of the page.
   *
   * :param section: the section element
   * :param url: the page's address, to make each link absolute
   * :return: the section's id, heading, points, paragraphs, table rows and links
   */
  static section(section, url) {
    const heading = section.querySelector("h1, h2");
    const points = [];
    for (const item of section.querySelectorAll("li")) points.push(GoodToKnow.text(item));
    const paragraphs = [];
    for (const paragraph of section.querySelectorAll("p")) paragraphs.push(GoodToKnow.text(paragraph));
    const rows = [];
    for (const row of section.querySelectorAll("tr")) {
      const cells = [];
      for (const cell of row.querySelectorAll("th, td")) cells.push(GoodToKnow.text(cell));
      rows.push(cells);
    }
    const links = [];
    for (const link of section.querySelectorAll("a[href]")) {
      // textContent leaves out where a link goes, so read its href too.
      links.push({
        text: GoodToKnow.text(link),
        href: new URL(link.getAttribute("href"), url).href,
      });
    }
    return {
      id: section.id || null,
      heading: heading ? GoodToKnow.text(heading) : "",
      points: points,
      paragraphs: paragraphs,
      rows: rows,
      links: links,
    };
  }

  /**
   * Read an element's text as one line, without the page's line breaks.
   *
   * :param element: the element
   * :return: the text
   */
  static text(element) {
    return element.textContent.replace(/\s+/g, " ").trim();
  }
}

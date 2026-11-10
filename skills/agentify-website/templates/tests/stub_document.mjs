import { StubElement } from "./stub_element.mjs";

/**
 * A small stand-in for the page document, so page scripts can be imported under Node.
 *
 * querySelector and getElementById return one cached StubElement per selector, so a
 * test can read what the page rendered into, for example, "#cart-total". When built with
 * fromHtml, an "#id" that is not in the page throws, so a mistyped id fails the test.
 */
export class StubDocument {
  /**
   * Build a document that only knows the ids found in the page's HTML.
   *
   * :param html: The text of index.html.
   * :return: The document.
   */
  static fromHtml(html) {
    const ids = new Set();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
      ids.add(match[1]);
    }
    return new StubDocument(ids);
  }

  /**
   * Create an empty document.
   *
   * :param knownIds: The ids that exist in the page, or null to accept any id.
   */
  constructor(knownIds = null) {
    this.knownIds = knownIds;
    this.elements = new Map();
    this.body = new StubElement("body");
    this.activeElement = null;
    this.forms = [];
    this.URL = "http://localhost:8080/";
    this.baseURI = this.URL;
  }

  /**
   * Return the element for a selector, creating it on first use.
   *
   * :param selector: A CSS selector, usually "#id".
   * :return: The cached element for that selector.
   * :raises Error: When the selector is an id that the page does not have.
   */
  querySelector(selector) {
    const isId = /^#[\w-]+$/.test(selector);
    if (isId && this.knownIds !== null && !this.knownIds.has(selector.slice(1))) {
      throw new Error(`The page has no element ${selector}.`);
    }
    if (!this.elements.has(selector)) {
      this.elements.set(selector, new StubElement(selector));
    }
    return this.elements.get(selector);
  }

  /**
   * Return the element for an id.
   *
   * :param id: The element id, without "#".
   * :return: The cached element for "#id".
   */
  getElementById(id) {
    return this.querySelector(`#${id}`);
  }

  /**
   * Return no matches. Page code that needs real results should be tested in a browser.
   *
   * :param selector: A CSS selector.
   * :return: An empty list.
   */
  querySelectorAll(selector) {
    return [];
  }

  /**
   * Create a detached element.
   *
   * :param tag: The tag name.
   * :return: The new element.
   */
  createElement(tag) {
    return new StubElement(tag);
  }

  /**
   * Accept document-level listeners from page code.
   *
   * :param name: The event name.
   * :param handler: The handler function.
   */
  addEventListener(name, handler) {
    this.body.addEventListener(name, handler);
  }
}

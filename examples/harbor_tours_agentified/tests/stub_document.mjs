import { StubDialog } from "./stub_dialog.mjs";
import { StubElement } from "./stub_element.mjs";

/**
 * A small stand-in for the page document, so page scripts can be imported under Node.
 *
 * querySelector("#id") and getElementById return one cached StubElement per id, so a
 * test can read what the page rendered into, for example, "#cart-total". When built with
 * fromHtml, an id that is not in the page throws, so a mistyped id fails the test. An
 * element marked hidden in the HTML starts hidden.
 *
 * The stub cannot search the page. Any other selector throws, unless the test gave its
 * matches with provide(). An empty or made-up result would let a test pass silently.
 */
export class StubDocument {
  /**
   * One start tag and its attributes. Quoted values may contain ">".
   */
  static START_TAG = /<[a-z][a-z0-9-]*((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/gi;

  /**
   * Build a document that only knows the ids found in the page's HTML.
   *
   * :param html: The text of index.html.
   * :param url: The page's address in the test, which document.URL gives.
   * :return: The document.
   */
  static fromHtml(html, url = "http://localhost:8080/") {
    const ids = new Set();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
      ids.add(match[1]);
    }
    const hidden = new Set();
    for (const tag of html.matchAll(StubDocument.START_TAG)) {
      // Blank out quoted values, so a class such as "card hidden" is not read as the attribute.
      const names = tag[1].replace(/"[^"]*"|'[^']*'/g, '""');
      const id = tag[1].match(/\sid="([^"]+)"/);
      if (id && /\shidden(?=[\s=]|$)/.test(names)) {
        hidden.add(id[1]);
      }
    }
    return new StubDocument(ids, hidden, url);
  }

  /**
   * Build the message for a selector the stub cannot search for.
   *
   * :param selector: The selector the page code used.
   * :return: The error message.
   */
  static cannotSearch(selector) {
    return `The stub cannot search the page for "${selector}". Give the test its matches with `
      + "document.provide(selector, elements), keep references to the elements in the page "
      + "code, or test this in a browser.";
  }

  /**
   * Create an empty document.
   *
   * :param knownIds: The ids that exist in the page, or null to accept any id.
   * :param hiddenIds: The ids of elements that start hidden.
   * :param url: The page's address in the test, which document.URL gives.
   */
  constructor(knownIds = null, hiddenIds = new Set(), url = "http://localhost:8080/") {
    this.knownIds = knownIds;
    this.hiddenIds = hiddenIds;
    this.elements = new Map();
    this.provided = new Map();
    this.body = new StubElement("body");
    this.activeElement = null;
    this.forms = [];
    this.URL = url;
    this.baseURI = this.URL;
  }

  /**
   * Say what a selector matches, for page code that searches the document. Use it for
   * matches that do not change during the test, such as the page's date inputs.
   *
   * :param selector: The exact selector the page code uses.
   * :param elements: The elements it finds, in page order.
   */
  provide(selector, elements) {
    this.provided.set(selector, elements);
  }

  /**
   * Return the element for "#id", or the first match given with provide().
   *
   * :param selector: A CSS selector.
   * :return: The element, or null when a provided selector matches nothing.
   * :raises Error: When the page has no such id, or the selector is not "#id" and was not
   *   provided.
   */
  querySelector(selector) {
    if (this.provided.has(selector)) {
      const found = this.provided.get(selector);
      return found.length ? found[0] : null;
    }
    if (!/^#[\w-]+$/.test(selector)) {
      throw new Error(StubDocument.cannotSearch(selector));
    }
    return this.getElementById(selector.slice(1));
  }

  /**
   * Return the element for an id, creating it on first use.
   *
   * :param id: The element id, without "#".
   * :return: The cached element for that id.
   * :raises Error: When the page does not have that id.
   */
  getElementById(id) {
    if (this.knownIds !== null && !this.knownIds.has(id)) {
      throw new Error(`The page has no element #${id}.`);
    }
    if (!this.elements.has(id)) {
      const element = new StubElement(`#${id}`);
      element.hidden = this.hiddenIds.has(id);
      this.elements.set(id, element);
    }
    return this.elements.get(id);
  }

  /**
   * Return the matches given with provide().
   *
   * :param selector: A CSS selector.
   * :return: A copy of the provided elements.
   * :raises Error: When the selector was not provided.
   */
  querySelectorAll(selector) {
    if (this.provided.has(selector)) {
      return [...this.provided.get(selector)];
    }
    throw new Error(StubDocument.cannotSearch(selector));
  }

  /**
   * Create a detached element. A "dialog" is a StubDialog, so tests can answer it.
   *
   * :param tag: The tag name.
   * :return: The new element.
   */
  createElement(tag) {
    if (tag === "dialog") {
      return new StubDialog();
    }
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

  /**
   * Describe every element with an id in the page, so a test can compare the whole page
   * before and after a call. The stand-in makes an element only when code first asks for
   * it, so this reads every id in the page's HTML, not only the elements made so far.
   *
   * :return: Each id's description, from describe().
   * :raises Error: When the document was not built with fromHtml, so it knows no ids.
   */
  snapshot() {
    if (this.knownIds === null) {
      throw new Error("snapshot() needs a document built with StubDocument.fromHtml.");
    }
    const page = {};
    for (const id of this.knownIds) {
      page[id] = StubDocument.describe(this.getElementById(id));
    }
    return page;
  }

  /**
   * Describe one element and its children as plain data.
   *
   * :param element: A StubElement, or a text child.
   * :return: The text of a text child, or the element's text, value, state, message,
   *   attributes and children.
   */
  static describe(element) {
    if (!(element instanceof StubElement)) {
      return String(element);
    }
    const children = [];
    for (const child of element.children) {
      children.push(StubDocument.describe(child));
    }
    return {
      tag: element.tag,
      text: element.textContent,
      value: element.value,
      checked: Boolean(element.checked),
      hidden: element.hidden,
      disabled: element.disabled,
      message: element.validationMessage,
      attributes: {...element.attributes},
      children: children,
    };
  }
}

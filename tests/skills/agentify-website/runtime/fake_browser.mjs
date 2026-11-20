import { FakeStorage } from "./fake_storage.mjs";

/**
 * One browser tab, enough to run the OpenRouter sign-in in Node.
 *
 * The object stands in for both `location` and `history`. It keeps one session storage
 * for the tab, which survives a visit to another page, and one local storage. Every
 * request to openrouter.ai goes to the mock OpenRouter. Any other request fails, so no
 * test reaches the network.
 */
export class FakeBrowser {
  /**
   * The globals install() replaces and restore() puts back.
   */
  static GLOBALS = ["location", "history", "sessionStorage", "localStorage", "isSecureContext", "top", "fetch"];

  /**
   * Open a tab on a page.
   *
   * :param pageUrl: The page's address.
   * :param openRouter: The mock OpenRouter that answers requests to openrouter.ai.
   * :param otari: The mock otari.ai that answers requests to otari.ai and its APIs, if any.
   */
  constructor(pageUrl, openRouter, otari = null) {
    this.url = new URL(pageUrl);
    this.openRouter = openRouter;
    this.otari = otari;
    this.assigned = [];
    this.session = new FakeStorage();
    this.local = new FakeStorage();
    this.saved = new Map();
  }

  /**
   * The page's full address.
   *
   * :return: The address.
   */
  get href() {
    return this.url.href;
  }

  /**
   * The page's origin.
   *
   * :return: The scheme, host and port.
   */
  get origin() {
    return this.url.origin;
  }

  /**
   * The page's host.
   *
   * :return: The host name and port.
   */
  get host() {
    return this.url.host;
  }

  /**
   * The page's host name.
   *
   * :return: The host name.
   */
  get hostname() {
    return this.url.hostname;
  }

  /**
   * The page's scheme.
   *
   * :return: The scheme, such as "https:".
   */
  get protocol() {
    return this.url.protocol;
  }

  /**
   * The page's path.
   *
   * :return: The path.
   */
  get pathname() {
    return this.url.pathname;
  }

  /**
   * The page's query string.
   *
   * :return: The query string with its "?", or an empty string.
   */
  get search() {
    return this.url.search;
  }

  /**
   * The page's fragment.
   *
   * :return: The fragment with its "#", or an empty string.
   */
  get hash() {
    return this.url.hash;
  }

  /**
   * Record that the page asked to leave for another address. The tab stays where it is
   * until the test calls visit().
   *
   * :param url: The address the page asked for.
   */
  assign(url) {
    this.assigned.push(String(url));
  }

  /**
   * Change the address without loading a page, as history.replaceState does.
   *
   * :param state: The history state. It is ignored.
   * :param title: The title. It is ignored.
   * :param url: The new address, relative to the current one.
   */
  replaceState(state, title, url) {
    this.url = new URL(url, this.url);
  }

  /**
   * Load another page in this tab. Session storage stays.
   *
   * :param url: The page's address.
   */
  visit(url) {
    this.url = new URL(url);
  }

  /**
   * Make this tab the page's globals: location, history, storage and fetch. The page
   * counts as a secure context in its own tab.
   */
  install() {
    for (const name of FakeBrowser.GLOBALS) {
      this.saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    FakeBrowser.define("location", this);
    FakeBrowser.define("history", this);
    FakeBrowser.define("sessionStorage", this.session);
    FakeBrowser.define("localStorage", this.local);
    FakeBrowser.define("isSecureContext", true);
    FakeBrowser.define("top", globalThis.self);
    FakeBrowser.define("fetch", this.fetch.bind(this));
  }

  /**
   * Put back the globals install() replaced.
   */
  restore() {
    for (const name of FakeBrowser.GLOBALS) {
      const descriptor = this.saved.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    this.saved.clear();
  }

  /**
   * Set a global that a later restore() can remove or put back.
   *
   * :param name: The global's name.
   * :param value: Its value.
   */
  static define(name, value) {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  }

  /**
   * The stub fetch. It sends requests for openrouter.ai to the mock OpenRouter, and
   * requests for otari.ai and its APIs to the mock otari.ai.
   *
   * :param input: The URL or Request.
   * :param init: The fetch options.
   * :return: The mock's response.
   * :raises Error: For any other address, so a test never reaches the network.
   */
  async fetch(input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    const origin = new URL(url).origin;
    if (origin === "https://openrouter.ai") return this.openRouter.answer(url, init);
    if (this.otari && /^https:\/\/((eu\.)?api\.)?otari\.ai$/.test(origin)) return this.otari.answer(url, init);
    throw new Error(`Unexpected network request: ${url}`);
  }
}

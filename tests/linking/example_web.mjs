// A fake web for the linking tests: site folders served from disk under their local URLs,
// the scripted router, and a fake bridge frame. Nothing leaves the process.
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serves site folders under local URLs through a stub fetch, and stands in for the few
 * browser parts the runtime uses to load a partner's bridge.
 *
 * The bridge frame acts as runtime/action-bridge.js does when the manifest next to it lists
 * no action module: it loads the page and that manifest, says it is ready, and lists no
 * actions. A dialog, such as the popup offer that follows a bridge that never answers, is
 * recorded and cancelled at once, as a visitor who will not open a popup would.
 *
 * Each request is recorded with flags only, never with header values.
 */
export class ExampleWeb {
  /**
   * The bridge protocol name (runtime/action-transport.js).
   */
  static PROTOCOL = "nsdeploy-actions-v1";

  /**
   * Content types by file extension.
   */
  static TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };

  /**
   * Set up an empty web with one router.
   *
   * :param router: The MockRouter that answers model requests.
   * :param routerOrigin: The router's origin, such as "http://127.0.0.1:8791".
   * :param key: The fake key, so requests that carry it can be flagged.
   */
  constructor(router, routerOrigin, key) {
    this.router = router;
    this.routerOrigin = routerOrigin;
    this.key = key;
    // Origin -> absolute folder path.
    this.sites = new Map();
    // URL -> a JSON value served instead of the file.
    this.replaced = new Map();
    // One entry per request, in order. "from" says whether the runtime or the frame asked.
    this.requests = [];
    // URLs that no site or router serves. A test expects none.
    this.unexpected = [];
    // One entry per bridge frame the runtime added.
    this.frames = [];
    // The text of each dialog the runtime opened.
    this.dialogs = [];
    // The window's "message" listeners.
    this.listeners = [];
    this.saved = null;
  }

  /**
   * Serve a folder under an origin.
   *
   * :param origin: The origin, such as "http://127.0.0.1:8080".
   * :param folder: The site folder.
   */
  serve(origin, folder) {
    this.sites.set(origin, path.resolve(folder));
  }

  /**
   * Serve a JSON value at a URL instead of the file there.
   *
   * :param url: The full URL.
   * :param value: The value to serve.
   */
  replace(url, value) {
    this.replaced.set(new URL(url).href, value);
  }

  /**
   * Read a JSON file from a served folder, as it is on disk.
   *
   * :param url: The full URL of the file.
   * :return: The parsed JSON.
   * :raises Error: When no folder serves the URL, or the file is missing or not JSON.
   */
  async readJson(url) {
    const parsed = new URL(url);
    const folder = this.sites.get(parsed.origin);
    if (folder === undefined) {
      throw new Error(`No site is served at ${parsed.origin}.`);
    }
    return JSON.parse(await readFile(path.join(folder, decodeURIComponent(parsed.pathname)), "utf8"));
  }

  /**
   * Answer fetch and stand in for document and window, from now on.
   */
  install() {
    this.saved = {
      fetch: globalThis.fetch,
      document: globalThis.document,
      window: globalThis.window,
    };
    globalThis.fetch = this.fetch.bind(this);
    globalThis.document = {
      createElement: this.createElement.bind(this),
      body: {
        append: this.appendToBody.bind(this),
      },
    };
    globalThis.window = {
      addEventListener: this.addListener.bind(this),
      removeEventListener: this.removeListener.bind(this),
      open: ExampleWeb.blockPopup,
    };
  }

  /**
   * Put back what install() replaced.
   */
  restore() {
    ExampleWeb.putGlobal("fetch", this.saved.fetch);
    ExampleWeb.putGlobal("document", this.saved.document);
    ExampleWeb.putGlobal("window", this.saved.window);
  }

  /**
   * Set a global, or delete it when the value is undefined, as Node has no document or window.
   *
   * :param name: The global's name.
   * :param value: Its value.
   */
  static putGlobal(name, value) {
    if (value === undefined) {
      delete globalThis[name];
    } else {
      globalThis[name] = value;
    }
  }

  /**
   * The stub fetch the runtime calls.
   *
   * :param input: The URL.
   * :param init: The fetch options.
   * :return: The response.
   */
  fetch(input, init) {
    return this.load(new URL(String(input)), "runtime", init || {});
  }

  /**
   * Answer one request from the router, a replaced value or a served folder.
   *
   * :param url: The URL.
   * :param from: "runtime" or "frame".
   * :param init: The fetch options.
   * :return: The response.
   */
  async load(url, from, init) {
    const headers = ExampleWeb.lowerHeaders(init.headers);
    const record = {
      seq: this.requests.length,
      from: from,
      method: String(init.method || "GET").toUpperCase(),
      url: url.href,
      origin: url.origin,
      path: url.pathname,
      authorization: headers.authorization !== undefined,
      keySent: this.holdsKey(headers),
      status: 0,
    };
    this.requests.push(record);
    if (url.origin === this.routerOrigin) {
      const body = typeof init.body === "string" ? init.body : "";
      const answer = this.router.respond(record.method, url.pathname, headers, body);
      record.status = answer.status;
      return new Response(answer.status === 204 ? null : answer.body, {
        status: answer.status,
        headers: {
          "Content-Type": answer.type,
        },
      });
    }
    if (this.replaced.has(url.href)) {
      record.status = 200;
      return ExampleWeb.respond(200, ExampleWeb.TYPES[".json"], JSON.stringify(this.replaced.get(url.href)));
    }
    const folder = this.sites.get(url.origin);
    if (folder === undefined) {
      this.unexpected.push(url.href);
      record.status = 404;
      return ExampleWeb.respond(404, "text/plain", "Not found");
    }
    const file = path.resolve(folder, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${folder}${path.sep}`)) {
      record.status = 403;
      return ExampleWeb.respond(403, "text/plain", "Forbidden");
    }
    let body = null;
    try {
      body = await readFile(file);
    } catch (error) {
      record.status = 404;
      return ExampleWeb.respond(404, "text/plain", "Not found");
    }
    record.status = 200;
    return ExampleWeb.respond(200, ExampleWeb.TYPES[path.extname(file)] || "application/octet-stream", body);
  }

  /**
   * Build a response.
   *
   * :param status: The HTTP status.
   * :param type: The content type.
   * :param body: The body, as text or bytes.
   * :return: The response.
   */
  static respond(status, type, body) {
    return new Response(body, {
      status: status,
      headers: {
        "Content-Type": type,
      },
    });
  }

  /**
   * Copy request headers into an object with lower-case names.
   *
   * :param headers: The headers as fetch accepts them, or undefined.
   * :return: The headers by lower-case name.
   */
  static lowerHeaders(headers) {
    const lower = {};
    for (const [name, value] of new Headers(headers || {})) {
      lower[name] = value;
    }
    return lower;
  }

  /**
   * Say whether any header holds the key, as is or URL-encoded.
   *
   * :param headers: The headers by lower-case name.
   * :return: True when a header holds the key.
   */
  holdsKey(headers) {
    for (const value of Object.values(headers)) {
      if (value.includes(this.key) || value.includes(encodeURIComponent(this.key))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Create a stand-in element. An iframe gets a window that acts as the bridge page.
   *
   * :param tag: The tag name.
   * :return: The stand-in.
   */
  createElement(tag) {
    const node = {
      tag: tag,
      style: {},
      children: [],
      textContent: "",
      record: null,
    };
    node.append = this.appendChildren.bind(this, node);
    node.remove = this.removeNode.bind(this, node);
    node.showModal = this.showDialog.bind(this, node);
    node.close = ExampleWeb.ignore;
    node.addEventListener = ExampleWeb.ignore;
    node.removeEventListener = ExampleWeb.ignore;
    if (tag === "iframe") {
      node.contentWindow = {
        postMessage: this.frameMessage.bind(this, node),
      };
    }
    return node;
  }

  /**
   * Keep an element's children, so a dialog's text and buttons can be read.
   *
   * :param node: The parent stand-in.
   * :param children: The appended stand-ins.
   */
  appendChildren(node, ...children) {
    for (const child of children) {
      node.children.push(child);
    }
  }

  /**
   * Mark a removed bridge frame.
   *
   * :param node: The removed stand-in.
   */
  removeNode(node) {
    if (node.record !== null) {
      node.record.removed = true;
    }
  }

  /**
   * Take an element added to the page. A bridge frame then starts to load.
   *
   * :param node: The stand-in added to document.body.
   */
  appendToBody(node) {
    if (node.tag !== "iframe") {
      return;
    }
    node.record = {
      src: node.src,
      sandbox: node.sandbox,
      hidden: node.hidden,
      // How many requests came before the frame, to order it against them.
      seq: this.requests.length,
      ready: false,
      error: null,
      removed: false,
    };
    this.frames.push(node.record);
    // The runtime waits for the frame's "ready" message, not for this promise.
    this.loadFrame(node).catch(this.frameFailed.bind(this, node));
  }

  /**
   * Note why a frame never said it was ready.
   *
   * :param node: The frame stand-in.
   * :param error: The error.
   */
  frameFailed(node, error) {
    node.record.error = String(error.message || error);
  }

  /**
   * Load the bridge page and the manifest next to it, then say the bridge is ready, as
   * runtime/action-bridge.js does.
   *
   * :param node: The frame stand-in.
   * :raises Error: When the page or its manifest is missing, or the manifest names site code.
   */
  async loadFrame(node) {
    const page = await this.load(new URL(node.src), "frame", {});
    if (!page.ok) {
      // A real frame would show the error page and never say it is ready.
      throw new Error(`The bridge page answered ${page.status}.`);
    }
    const response = await this.load(new URL("agent-manifest.json", node.src), "frame", {});
    if (!response.ok) {
      throw new Error(`The bridge's agent-manifest.json answered ${response.status}.`);
    }
    const manifest = await response.json();
    const actions = manifest.actions || {};
    if (actions.module || actions.modules || actions.catalog || actions.pages || actions.hostPage) {
      throw new Error("The bridge's manifest names site code, which this fake frame cannot run.");
    }
    if (!Array.isArray(manifest.networks) || !manifest.networks.length || typeof manifest.networks[0].name !== "string") {
      throw new Error("The bridge's manifest has no networks[0].name.");
    }
    if (node.record.removed) {
      return;
    }
    node.record.ready = true;
    const event = {
      source: node.contentWindow,
      origin: new URL(node.src).origin,
      data: {
        protocol: ExampleWeb.PROTOCOL,
        type: "ready",
      },
      ports: [],
    };
    for (const listener of this.listeners.slice()) {
      listener(event);
    }
  }

  /**
   * Take the caller's "connect" message and answer on the port it sends.
   *
   * :param node: The frame stand-in.
   * :param message: The message.
   * :param targetOrigin: The origin the caller addressed.
   * :param transfer: The transferred ports.
   */
  frameMessage(node, message, targetOrigin, transfer) {
    if (message.protocol !== ExampleWeb.PROTOCOL || message.type !== "connect" || !Array.isArray(transfer) || transfer.length !== 1) {
      return;
    }
    node.record.connectedFor = targetOrigin;
    const port = transfer[0];
    port.onmessage = this.answerBridge.bind(this, port);
  }

  /**
   * Answer a request on the bridge port. A bridge whose manifest lists no action module
   * shares no actions.
   *
   * :param port: The bridge's end of the channel.
   * :param event: The message event.
   */
  answerBridge(port, event) {
    const data = event.data || {};
    if (data.type === "catalog") {
      port.postMessage({
        id: data.id,
        ok: true,
        value: [],
      });
      return;
    }
    port.postMessage({
      id: data.id,
      ok: false,
      error: "Action is not exposed to this caller.",
    });
  }

  /**
   * Record a dialog's text and press its Cancel button.
   *
   * :param node: The dialog stand-in.
   */
  showDialog(node) {
    const parts = [];
    let cancel = null;
    for (const child of node.children) {
      parts.push(String(child.textContent || ""));
      if (child.textContent === "Cancel" && typeof child.onclick === "function") {
        cancel = child.onclick;
      }
    }
    this.dialogs.push(parts.join(" "));
    if (cancel !== null) {
      setTimeout(cancel, 0);
    }
  }

  /**
   * Keep a window "message" listener.
   *
   * :param type: The event type.
   * :param handler: The listener.
   */
  addListener(type, handler) {
    if (type === "message") {
      this.listeners.push(handler);
    }
  }

  /**
   * Drop a window "message" listener.
   *
   * :param type: The event type.
   * :param handler: The listener.
   */
  removeListener(type, handler) {
    const index = this.listeners.indexOf(handler);
    if (type === "message" && index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Stand in for window.open: popups are blocked.
   *
   * :return: null.
   */
  static blockPopup() {
    return null;
  }

  /**
   * Do nothing. Stands in for element methods the runtime calls but the tests do not need.
   */
  static ignore() {
  }

  /**
   * List the requests to one origin.
   *
   * :param origin: The origin.
   * :param from: "runtime", "frame", or null for both.
   * :return: The request records, in order.
   */
  requestsTo(origin, from) {
    const found = [];
    for (const record of this.requests) {
      if (record.origin === origin && (from === null || record.from === from)) {
        found.push(record);
      }
    }
    return found;
  }
}

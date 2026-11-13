// Drives one page in headless Chrome for the linking check, and records what happened:
// each request with header flags, the console, dialogs, frames, consent cards, the chat
// and the runtime's trace.
import { CdpClient } from "./cdp_client.mjs";
import { PageScripts } from "./page_scripts.mjs";

/**
 * One page in its own browser context, like a new visitor: open it, set up the visitor's
 * key, send one message, answer the card and wait for the turn to end.
 *
 * Requests come from the DevTools Network domain of the page and of each frame, so the
 * bridge frame's requests count too. For each request it keeps the URL, the status and
 * flags: whether Authorization was sent, which headers held the key, and the cookie
 * names. It never keeps a header value, and it replaces the key in any text it keeps.
 *
 * A cross-site frame starts paused, because the page asks DevTools to attach to each
 * frame before it runs. While it is paused, the run reads the page's iframes, so it sees
 * the bridge frame's sandbox before the frame can finish and be removed.
 */
export class LinkCallRun {
  /**
   * Keep the connection and set up empty records.
   *
   * :param client: The CdpClient connected to the browser.
   * :param key: The fake key, so it can be flagged and kept out of the records.
   */
  constructor(client, key) {
    this.client = client;
    this.key = key;
    this.context = null;
    this.target = null;
    this.page = null;
    // Child session id -> its target info, for this page's frames.
    this.children = new Map();
    // "<session>|<requestId>" -> request record.
    this.requests = new Map();
    this.console = [];
    this.timeline = [];
    // The page's iframes, read while each cross-site frame was paused.
    this.frames = [];
    // Every iframe src seen while polling.
    this.polledFrames = [];
    // Each dialog other than a consent card, with when it appeared.
    this.dialogs = [];
    this.cardTexts = [];
    this.setup = null;
    this.started = Date.now();
    this.sentAt = null;
    this.consentShownAt = null;
    this.consentAnsweredAt = null;
    this.endedAt = null;
    this.outcome = null;
    this.collected = null;
    this.handler = this.onEvent.bind(this);
  }

  /**
   * Replace the key in a text.
   *
   * :param text: Any text, or null.
   * :return: The text with "<key>" in place of the key.
   */
  scrub(text) {
    if (text === null || text === undefined) {
      return text;
    }
    return String(text).split(this.key).join("<key>").split(encodeURIComponent(this.key)).join("<key>");
  }

  /**
   * Add a timeline entry.
   *
   * :param what: A short label.
   * :param detail: Any detail, as plain data, or null.
   */
  note(what, detail) {
    const entry = {
      ms: Date.now() - this.started,
      what: what,
    };
    if (detail !== null && detail !== undefined) {
      entry.detail = this.scrub(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    this.timeline.push(entry);
  }

  /**
   * Open a URL in a new browser context, with its own storage and cookies.
   *
   * :param url: The page URL.
   * :raises Error: When DevTools refuses a command.
   */
  async open(url) {
    this.client.onEvent(this.handler);
    const context = await this.client.send("Target.createBrowserContext", {disposeOnDetach: true});
    this.context = context.browserContextId;
    const target = await this.client.send("Target.createTarget", {
      url: "about:blank",
      browserContextId: this.context,
    });
    this.target = target.targetId;
    const attached = await this.client.send("Target.attachToTarget", {
      targetId: this.target,
      flatten: true,
    });
    this.page = attached.sessionId;
    await this.prepareSession(this.page, true);
    this.note("navigate", url);
    await this.client.send("Page.navigate", {url: url}, this.page);
  }

  /**
   * Turn on the domains this run records, in one session.
   *
   * :param sessionId: The page or frame session.
   * :param isPage: True for the page, which also attaches to its frames.
   */
  async prepareSession(sessionId, isPage) {
    if (isPage) {
      await this.client.send("Page.enable", {}, sessionId);
      await this.client.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      }, sessionId);
    }
    await this.client.send("Runtime.enable", {}, sessionId);
    await this.client.send("Log.enable", {}, sessionId);
    await this.client.send("Network.enable", {}, sessionId);
    await this.client.send("Network.setCacheDisabled", {cacheDisabled: true}, sessionId);
  }

  /**
   * Set up a frame or worker that attached paused, then let it run. For a frame, first
   * read the page's iframes, while the frame cannot finish.
   *
   * :param sessionId: Its session.
   * :param info: Its target info.
   */
  async prepareChild(sessionId, info) {
    try {
      if (info.type === "iframe") {
        const frames = JSON.parse(await this.client.evaluate(this.page, PageScripts.frames()));
        for (const frame of frames) {
          this.frames.push(frame);
        }
      }
      await this.prepareSession(sessionId, false);
    } catch (error) {
      this.note("frame setup failed", String(error.message || error));
    } finally {
      await this.client.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(LinkCallRun.ignore);
    }
  }

  /**
   * Swallow an error that does not matter, such as a frame that already closed.
   *
   * :param error: The error.
   * :return: The error.
   */
  static ignore(error) {
    return error;
  }

  /**
   * Say whether an event belongs to this page or one of its frames.
   *
   * :param sessionId: The event's session.
   * :return: True when it does.
   */
  ours(sessionId) {
    return sessionId !== undefined && (sessionId === this.page || this.children.has(sessionId));
  }

  /**
   * Record one DevTools event of this page or its frames.
   *
   * :param message: The raw event, with method, params and sessionId.
   */
  onEvent(message) {
    if (!this.ours(message.sessionId)) {
      return;
    }
    const params = message.params || {};
    const where = message.sessionId === this.page ? "page" : "frame";
    if (message.method === "Target.attachedToTarget") {
      this.children.set(params.sessionId, params.targetInfo);
      this.note("target attached", params.targetInfo.type);
      this.prepareChild(params.sessionId, params.targetInfo);
    } else if (message.method === "Network.requestWillBeSent") {
      const record = this.request(message.sessionId, params.requestId);
      record.url = params.request.url;
      record.method = params.request.method;
      record.type = params.type;
      record.wall = Math.round(params.wallTime * 1000);
      this.flag(record, params.request.headers);
    } else if (message.method === "Network.requestWillBeSentExtraInfo") {
      this.flag(this.request(message.sessionId, params.requestId), params.headers);
    } else if (message.method === "Network.responseReceived") {
      this.request(message.sessionId, params.requestId).status = params.response.status;
    } else if (message.method === "Network.loadingFailed") {
      const record = this.request(message.sessionId, params.requestId);
      record.failed = params.errorText;
      record.corsError = params.corsErrorStatus?.corsError || null;
    } else if (message.method === "Runtime.consoleAPICalled") {
      this.console.push({
        where: where,
        type: params.type,
        text: this.scrub(LinkCallRun.argText(params.args)),
      });
    } else if (message.method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails || {};
      this.console.push({
        where: where,
        type: "exception",
        text: this.scrub(details.exception?.description || details.text),
      });
    } else if (message.method === "Log.entryAdded") {
      this.console.push({
        where: where,
        type: `log-${params.entry.level}`,
        text: this.scrub(params.entry.text),
        url: params.entry.url || null,
      });
    } else if (message.method === "Page.javascriptDialogOpening") {
      // The runtime uses <dialog> elements. A browser dialog would block the page.
      this.dialogs.push({
        text: this.scrub(params.message),
        at: Date.now(),
      });
      this.client.send("Page.handleJavaScriptDialog", {accept: false}, this.page).catch(LinkCallRun.ignore);
    }
  }

  /**
   * Get or create the record of one request.
   *
   * :param sessionId: The session that reported it.
   * :param requestId: Its DevTools request id.
   * :return: The record.
   */
  request(sessionId, requestId) {
    const key = `${sessionId}|${requestId}`;
    if (!this.requests.has(key)) {
      this.requests.set(key, {
        session: sessionId === this.page ? "page" : "frame",
        url: null,
        authorization: false,
        keyIn: new Set(),
        cookies: new Set(),
      });
    }
    return this.requests.get(key);
  }

  /**
   * Note what a request's headers hold, without their values.
   *
   * :param record: The request record.
   * :param headers: Header names to values.
   */
  flag(record, headers) {
    for (const name of Object.keys(headers || {})) {
      const value = String(headers[name]);
      const lower = name.toLowerCase();
      if (lower === "authorization") {
        record.authorization = true;
      }
      if (value.includes(this.key) || value.includes(encodeURIComponent(this.key))) {
        record.keyIn.add(lower);
      }
      if (lower === "cookie") {
        for (const part of value.split(";")) {
          const cookie = part.split("=")[0].trim();
          if (cookie) {
            record.cookies.add(cookie);
          }
        }
      }
    }
  }

  /**
   * Turn console arguments into one line of text.
   *
   * :param args: Runtime.RemoteObject values.
   * :return: The text.
   */
  static argText(args) {
    const parts = [];
    for (const arg of args || []) {
      if (arg.value !== undefined) {
        parts.push(typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value));
      } else {
        parts.push(arg.description || arg.type);
      }
    }
    return parts.join(" ");
  }

  /**
   * Evaluate a script in the page.
   *
   * :param expression: The script.
   * :return: Its value.
   * :raises Error: When the script throws.
   */
  evaluate(expression) {
    return this.client.evaluate(this.page, expression);
  }

  /**
   * Evaluate a page script until its value is truthy.
   *
   * :param expression: The page script.
   * :param timeoutMs: How long to wait.
   * :param label: What is awaited, for the error message.
   * :return: The truthy value.
   * :raises Error: On timeout.
   */
  async waitFor(expression, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let value = null;
      try {
        value = await this.evaluate(expression);
      } catch (error) {
        // The page may be between documents during a reload.
        value = null;
      }
      if (value) {
        return value;
      }
      await CdpClient.sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  /**
   * Fill in the visitor's settings, apply them and wait for the reload.
   *
   * :param router: The router base URL.
   * :param model: The visitor's model, or "" for none.
   * :raises Error: When the reloaded page does not get the key in time.
   */
  async applySetup(router, model) {
    await this.waitFor(PageScripts.ready(), 20000, "the runtime to boot");
    await this.evaluate(PageScripts.applySetup(this.key, router, model));
    this.note("settings applied", {
      router: router,
      model: model || "(none)",
    });
    await this.waitFor(PageScripts.keyApplied(this.key), 20000, "the reload with the key");
    this.setup = JSON.parse(await this.evaluate(PageScripts.engineState()));
  }

  /**
   * Send one message, answer every consent card the same way, cancel every other dialog,
   * and wait for the turn to end.
   *
   * :param message: The visitor's message.
   * :param decision: "allow", "always" or "decline".
   * :param timeoutMs: How long the turn may take.
   */
  async turn(message, decision, timeoutMs) {
    await this.evaluate(PageScripts.send(message));
    this.sentAt = Date.now();
    this.note("message sent", message);
    const deadline = this.sentAt + timeoutMs;
    let started = false;
    while (Date.now() < deadline) {
      let state = null;
      try {
        state = JSON.parse(await this.evaluate(PageScripts.poll()));
      } catch (error) {
        await CdpClient.sleep(50);
        continue;
      }
      if (state.consent !== null) {
        this.cardTexts.push(state.consent);
        if (this.consentShownAt === null) {
          this.consentShownAt = Date.now();
        }
        await this.evaluate(PageScripts.answerConsent(decision));
        if (this.consentAnsweredAt === null) {
          this.consentAnsweredAt = Date.now();
        }
        this.note(`consent card answered: ${decision}`, state.consent);
      }
      if (state.dialogs.length) {
        for (const text of state.dialogs) {
          this.dialogs.push({
            text: this.scrub(text),
            at: Date.now(),
          });
        }
        this.note("dialogs cancelled", await this.evaluate(PageScripts.cancelDialogs()));
      }
      for (const src of state.iframes) {
        if (!this.polledFrames.includes(src)) {
          this.polledFrames.push(src);
        }
      }
      if (state.turn === "true") {
        started = true;
      }
      if (started && state.turn === "false") {
        this.endedAt = Date.now();
        this.outcome = "ended";
        this.note("turn ended", null);
        return;
      }
      await CdpClient.sleep(50);
    }
    this.outcome = "timeout";
    this.note("turn timed out", null);
  }

  /**
   * Read the chat, the cards and the trace from the page, then let late events arrive.
   */
  async finish() {
    this.collected = JSON.parse(await this.evaluate(PageScripts.collect()));
    await CdpClient.sleep(400);
  }

  /**
   * Close the page and its browser context.
   */
  async close() {
    this.client.offEvent(this.handler);
    if (this.target !== null) {
      await this.client.send("Target.closeTarget", {targetId: this.target}).catch(LinkCallRun.ignore);
    }
    if (this.context !== null) {
      await this.client.send("Target.disposeBrowserContext", {browserContextId: this.context}).catch(LinkCallRun.ignore);
    }
  }

  /**
   * Sort helper: earlier wall time first.
   *
   * :param left: A record with wall.
   * :param right: Another record with wall.
   * :return: A negative, zero or positive number.
   */
  static byWall(left, right) {
    return (left.wall || 0) - (right.wall || 0);
  }

  /**
   * Everything the run saw, as plain data with no key in it.
   *
   * :return: The evidence.
   */
  evidence() {
    const requests = [];
    for (const record of this.requests.values()) {
      if (!record.url || record.url.startsWith("data:")) {
        continue;
      }
      const url = new URL(record.url);
      requests.push({
        wall: record.wall || 0,
        session: record.session,
        method: record.method,
        url: record.url,
        host: url.host,
        path: url.pathname,
        type: record.type,
        status: record.status === undefined ? null : record.status,
        failed: record.failed || null,
        corsError: record.corsError || null,
        authorization: record.authorization,
        keyIn: Array.from(record.keyIn),
        cookies: Array.from(record.cookies),
      });
    }
    requests.sort(LinkCallRun.byWall);
    const collected = this.collected || {
      messages: [],
      cards: 0,
      actionStatus: "",
      actionStatusDetail: "",
      agents: "",
      iframes: [],
      trace: [],
    };
    let finalAnswer = null;
    for (const message of collected.messages) {
      if (message.cls.includes("bot") && !message.cls.includes("ns-consent")) {
        finalAnswer = message.text;
      }
    }
    return {
      outcome: this.outcome,
      setup: this.setup,
      timing: {
        started: this.started,
        sentAt: this.sentAt,
        consentShownAt: this.consentShownAt,
        consentAnsweredAt: this.consentAnsweredAt,
        endedAt: this.endedAt,
      },
      cards: collected.cards,
      cardTexts: this.cardTexts,
      frames: this.frames,
      polledFrames: this.polledFrames,
      dialogs: this.dialogs,
      finalAnswer: this.scrub(finalAnswer),
      actionStatus: collected.actionStatus,
      actionStatusDetail: this.scrub(collected.actionStatusDetail),
      agents: collected.agents,
      trace: this.traceSummary(collected.trace),
      requests: requests,
      console: this.console,
      timeline: this.timeline,
    };
  }

  /**
   * Keep the trace events the checks need: partner fetches and calls, model calls, tool
   * results and the runtime's notes.
   *
   * :param trace: The runtime's trace events.
   * :return: The summary.
   */
  traceSummary(trace) {
    const summary = {
      remoteFetch: [],
      remoteCall: [],
      modelCalls: [],
      tools: [],
      notes: [],
    };
    for (const event of trace) {
      if (event.kind === "remote_fetch" && event.phase !== "update") {
        summary.remoteFetch.push({
          phase: event.phase,
          wall: event.wall,
          status: event.status,
          peerOrigin: event.peerOrigin,
          error: this.scrub(event.error || null),
        });
      } else if (event.kind === "remote_call" && event.phase !== "update") {
        summary.remoteCall.push({
          phase: event.phase,
          wall: event.wall,
          status: event.status,
          durationMs: event.durationMs === undefined ? null : Math.round(event.durationMs),
          network: event.network,
          slyDataKeys: Object.keys(event.requestPayload?.sly_data || {}),
          response: this.scrub(event.responsePreview || null),
        });
      } else if (event.kind === "model_call" && event.phase === "start") {
        summary.modelCalls.push({
          wall: event.wall,
          origin: event.origin,
          model: event.model,
          routerHost: event.routerHost,
          tools: event.toolNames,
        });
      } else if (event.kind === "tool" && event.phase === "end") {
        summary.tools.push({
          tool: event.tool,
          toolKind: event.toolKind,
          status: event.status,
          result: this.scrub(event.resultPreview),
        });
      } else if (event.kind === "consent" || event.kind === "composition_limit" || event.kind === "composition_skip") {
        summary.notes.push({
          kind: event.kind,
          reason: event.reason || null,
          target: event.target || null,
          decision: event.decision || null,
        });
      }
    }
    return summary;
  }
}

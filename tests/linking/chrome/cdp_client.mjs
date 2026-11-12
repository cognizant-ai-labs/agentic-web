// A small Chrome DevTools Protocol client over the browser's WebSocket, in flat-session mode.
// It needs Node 22 or newer, which has a global WebSocket.

/**
 * Sends DevTools commands and passes every event to the registered handlers.
 *
 * Commands to a page or frame go through its session id, so one connection drives the
 * page and its out-of-process frames. A command that gets no answer fails after a time
 * limit, so a stuck browser cannot stop the check.
 */
export class CdpClient {
  /**
   * How long a command may wait for its answer.
   */
  static COMMAND_TIMEOUT_MS = 30000;

  /**
   * Wrap an open WebSocket.
   *
   * :param socket: The open WebSocket to the browser.
   */
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    // Command id -> {resolve, reject, method, timer}.
    this.pending = new Map();
    this.handlers = [];
  }

  /**
   * Connect to the browser behind a DevTools port.
   *
   * :param port: The --remote-debugging-port.
   * :return: The connected client.
   * :raises Error: When the port does not answer or the socket fails to open.
   */
  static async connect(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    const info = await response.json();
    const socket = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise(CdpClient.waitOpen.bind(null, socket));
    const client = new CdpClient(socket);
    socket.addEventListener("message", client.receive.bind(client));
    socket.addEventListener("close", client.failAll.bind(client));
    return client;
  }

  /**
   * Resolve when the socket opens, and reject on an error.
   *
   * :param socket: The WebSocket.
   * :param resolve: The promise's resolve function.
   * :param reject: The promise's reject function.
   */
  static waitOpen(socket, resolve, reject) {
    socket.addEventListener("open", resolve, {once: true});
    socket.addEventListener("error", reject, {once: true});
  }

  /**
   * Send one command.
   *
   * :param method: The DevTools method, such as "Runtime.evaluate".
   * :param params: The method's parameters.
   * :param sessionId: The target session, or undefined for the browser.
   * :return: The command's result.
   * :raises Error: When DevTools returns an error or no answer comes in time.
   */
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId;
    this.nextId += 1;
    const message = {
      id: id,
      method: method,
      params: params,
    };
    if (sessionId) {
      message.sessionId = sessionId;
    }
    const result = new Promise(this.track.bind(this, id, method));
    this.socket.send(JSON.stringify(message));
    return result;
  }

  /**
   * Remember a command until its answer arrives or its time runs out.
   *
   * :param id: The command id.
   * :param method: The method, for error messages.
   * :param resolve: The promise's resolve function.
   * :param reject: The promise's reject function.
   */
  track(id, method, resolve, reject) {
    const timer = setTimeout(this.expire.bind(this, id), CdpClient.COMMAND_TIMEOUT_MS);
    this.pending.set(id, {
      resolve: resolve,
      reject: reject,
      method: method,
      timer: timer,
    });
  }

  /**
   * Fail a command that got no answer in time.
   *
   * :param id: The command id.
   */
  expire(id) {
    const waiter = this.pending.get(id);
    if (waiter) {
      this.pending.delete(id);
      waiter.reject(new Error(`${waiter.method}: no answer from the browser.`));
    }
  }

  /**
   * Fail every waiting command, once the connection closes.
   */
  failAll() {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${waiter.method}: the browser connection closed.`));
    }
    this.pending.clear();
  }

  /**
   * Route one message: an answer to its command, an event to the handlers.
   *
   * :param event: The WebSocket message event.
   */
  receive(event) {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) {
        waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    for (const handler of this.handlers.slice()) {
      handler(message);
    }
  }

  /**
   * Register an event handler. It receives every event, with its sessionId.
   *
   * :param handler: A function that takes the raw event message.
   */
  onEvent(handler) {
    this.handlers.push(handler);
  }

  /**
   * Remove an event handler.
   *
   * :param handler: A handler passed to onEvent.
   */
  offEvent(handler) {
    const index = this.handlers.indexOf(handler);
    if (index >= 0) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * Evaluate a script in a page and return its value.
   *
   * :param sessionId: The page session.
   * :param expression: The script. Its completion value is returned.
   * :return: The value, or undefined.
   * :raises Error: When the script throws.
   */
  async evaluate(sessionId, expression) {
    const result = await this.send("Runtime.evaluate", {
      expression: expression,
      returnByValue: true,
      awaitPromise: true,
      replMode: true,
    }, sessionId);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`Page script failed: ${detail}`);
    }
    return result.result.value;
  }

  /**
   * Close the connection.
   */
  close() {
    this.socket.close();
  }

  /**
   * Wait for a while.
   *
   * :param ms: Milliseconds.
   * :return: A promise that resolves after ms.
   */
  static sleep(ms) {
    return new Promise(CdpClient.delay.bind(null, ms));
  }

  /**
   * Resolve after ms milliseconds.
   *
   * :param ms: Milliseconds.
   * :param resolve: The promise's resolve function.
   */
  static delay(ms, resolve) {
    setTimeout(resolve, ms);
  }
}

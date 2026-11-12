import { once } from "node:events";
import http from "node:http";

/**
 * A small HTTP server for tests that answers each path from a table.
 *
 * Each route has a status, headers and a body, and a path missing from the table gets 404.
 * It adds no CORS or framing header of its own, so a test decides those exactly. It
 * listens on 127.0.0.1 and a free port, and records each request's path and Origin.
 */
export class BareServer {
  /**
   * Store the routes. Call start() to listen.
   *
   * :param routes: An object from URL path to {status, headers, body}. A test may change it
   *   while the server runs.
   */
  constructor(routes) {
    this.routes = routes;
    this.requests = [];
    this.server = null;
  }

  /**
   * Listen on 127.0.0.1 and a free port.
   *
   * :return: The server's origin, such as http://127.0.0.1:50123.
   */
  async start() {
    this.server = http.createServer(BareServer.answer.bind(null, this));
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    return `http://127.0.0.1:${this.server.address().port}`;
  }

  /**
   * Stop listening and close open connections, such as ones fetch keeps alive.
   */
  async stop() {
    if (this.server === null) {
      return;
    }
    const closed = once(this.server, "close");
    this.server.close();
    this.server.closeAllConnections();
    await closed;
    this.server = null;
  }

  /**
   * Record one request and answer it from the table.
   *
   * :param bare: The BareServer.
   * :param request: The incoming request.
   * :param response: The response to write.
   */
  static answer(bare, request, response) {
    const urlPath = new URL(request.url, "http://127.0.0.1").pathname;
    bare.requests.push({
      path: urlPath,
      origin: request.headers.origin || null,
    });
    const route = Object.hasOwn(bare.routes, urlPath) ? bare.routes[urlPath] : null;
    if (route === null) {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Not found");
      return;
    }
    response.writeHead(route.status, route.headers);
    response.end(route.body);
  }
}

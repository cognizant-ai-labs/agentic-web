// Checks skills/agentify-website/scripts/check_partner.mjs against fake partner sites.
// Run from the repository root: node --test "tests/skills/agentify-website/scripts/*.test.mjs"
// Most partners are route tables served by BareServer on 127.0.0.1, or by a stand-in
// fetch for an https partner. One test builds and serves the fixture site with the skill's
// own scripts. Nothing reaches the internet and no model is called.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PartnerCheck } from "../../../../skills/agentify-website/scripts/check_partner.mjs";
import { BareServer } from "./bare_server.mjs";

/**
 * Runs the partner check on good and broken partner sites.
 *
 * A good partner has CORS on its public files, a valid network, and a bridge in one of
 * the two layouts. Each broken partner has one mistake, and the check must name it.
 */
class CheckPartnerTest {
  /**
   * The skill folder.
   */
  static SKILL = fileURLToPath(new URL("../../../../skills/agentify-website/", import.meta.url));

  /**
   * The fixture site for the end-to-end test.
   */
  static FIXTURE = fileURLToPath(new URL("./fixtures/linked_site/", import.meta.url));

  /**
   * The calling site's origin in every check.
   */
  static CALLER = "http://localhost:8082";

  /**
   * Return a fresh manifest for the fake partner.
   *
   * :param layout: "skill" for a bridge in bridge/, or "nsdeploy" for one next to the manifest.
   * :return: The manifest.
   */
  static manifest(layout) {
    return {
      brand: "Harbor Tours Assistant",
      networks: [
        {
          name: "harbor_tours",
          front_man: "tours_assistant",
          hocon: "./harbor_tours.network.json",
        },
      ],
      actions: {
        version: 1,
        module: "./site-actions.js",
        bridge: layout === "nsdeploy" ? "./action-bridge.html" : "./bridge/action-bridge.html",
        agentTools: [
          "get_trips",
        ],
      },
    };
  }

  /**
   * Return a fresh, valid network for the fake partner.
   *
   * :return: The network config, as its published .network.json holds it.
   */
  static network() {
    return {
      llm_config: {
        model_name: "gpt-4.1-mini",
      },
      max_steps: 12,
      tools: [
        {
          name: "tours_assistant",
          function: {
            description: "Answers questions about Harbor Tours' boat trips.",
          },
          instructions: "You answer questions about Harbor Tours' boat trips.\nWhen you have no website_* tools, another site's assistant is asking for its visitor.",
          tools: [],
        },
      ],
    };
  }

  /**
   * Make a route that answers with JSON.
   *
   * :param value: The value to send.
   * :param cors: True to send Access-Control-Allow-Origin: *.
   * :return: The route.
   */
  static json(value, cors) {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
    };
    if (cors) {
      headers["Access-Control-Allow-Origin"] = "*";
    }
    return {
      status: 200,
      headers: headers,
      body: JSON.stringify(value),
    };
  }

  /**
   * Make a route that answers with a file's text.
   *
   * :param body: The text.
   * :param type: The Content-Type.
   * :return: The route.
   */
  static file(body, type) {
    return {
      status: 200,
      headers: {
        "Content-Type": type,
      },
      body: body,
    };
  }

  /**
   * Build the route table of a partner site with CORS on its public files.
   *
   * :param layout: "skill" or "nsdeploy", as for manifest().
   * :param manifest: The manifest to serve.
   * :param network: The network to serve.
   * :return: The routes.
   */
  static async partnerRoutes(layout, manifest, network) {
    const routes = {
      "/agent-manifest.json": CheckPartnerTest.json(manifest, true),
      "/harbor_tours.network.json": CheckPartnerTest.json(network, true),
      "/site-actions.js": CheckPartnerTest.file("export function registerActions() {}", "text/javascript; charset=utf-8"),
      "/runtime/action-bridge.js": CheckPartnerTest.file("// The runtime's bridge script.", "text/javascript; charset=utf-8"),
    };
    if (layout === "nsdeploy") {
      routes["/action-bridge.html"] = CheckPartnerTest.file("<!doctype html><html><head><meta charset=\"utf-8\"><title>Bridge</title></head><body><script type=\"module\" src=\"./runtime/action-bridge.js\"></script></body></html>", "text/html; charset=utf-8");
    } else {
      const page = await readFile(path.join(CheckPartnerTest.SKILL, "templates", "bridge", "action-bridge.html"), "utf8");
      const bridgeManifest = {
        networks: [
          {
            name: "harbor_tours",
          },
        ],
        actions: {
          version: 1,
        },
      };
      routes["/bridge/action-bridge.html"] = CheckPartnerTest.file(page, "text/html; charset=utf-8");
      routes["/bridge/agent-manifest.json"] = CheckPartnerTest.json(bridgeManifest, false);
    }
    return routes;
  }

  /**
   * Keep one printed line.
   *
   * :param lines: The list to add to.
   * :param line: The line.
   */
  static collect(lines, line) {
    lines.push(line);
  }

  /**
   * Run the check in this process and keep what it prints.
   *
   * :param argv: The arguments, as on the command line.
   * :param fetchImpl: The fetch to use.
   * :return: The exit code, the printed lines and the WARNING and ERROR lines.
   */
  static async check(argv, fetchImpl) {
    const lines = [];
    const code = await PartnerCheck.main(argv, fetchImpl, CheckPartnerTest.collect.bind(null, lines));
    const findings = [];
    for (const line of lines) {
      if (line.startsWith("WARNING: ") || line.startsWith("ERROR: ")) {
        findings.push(line);
      }
    }
    return {
      code: code,
      lines: lines,
      out: lines.join("\n"),
      findings: findings,
    };
  }

  /**
   * Serve a partner with BareServer and check it from the caller's origin.
   *
   * :param routes: The partner's routes.
   * :param name: The network name to put in the URL.
   * :return: The server, its origin and the check's result. The caller stops the server.
   */
  static async serveAndCheck(routes, name) {
    const server = new BareServer(routes);
    const origin = await server.start();
    try {
      const result = await CheckPartnerTest.check([`${origin}/${name}`, "--origin", CheckPartnerTest.CALLER], fetch);
      return {
        server: server,
        origin: origin,
        result: result,
      };
    } catch (error) {
      await server.stop();
      throw error;
    }
  }

  /**
   * Answer a request from a route table, in place of fetch, and record the call.
   *
   * :param routes: The partner's routes.
   * :param calls: The list of calls to add to.
   * :param url: The requested URL.
   * :param init: The fetch options.
   * :return: The response.
   */
  static async stubFetch(routes, calls, url, init) {
    calls.push({
      url: String(url),
      init: init,
    });
    const urlPath = new URL(url).pathname;
    if (!Object.hasOwn(routes, urlPath)) {
      return new Response("Not found", { status: 404 });
    }
    const route = routes[urlPath];
    return new Response(route.body, {
      status: route.status,
      headers: route.headers,
    });
  }

  /**
   * A good partner passes, prints the lines to paste, and is read with the caller's Origin
   * through its public files and bridge only.
   */
  static async testGoodPartnerPasses() {
    // Importing the script must not run it.
    assert.equal(process.exitCode, undefined);
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      const url = `${served.origin}/harbor_tours`;
      const result = served.result;
      assert.equal(result.code, 0, result.out);
      assert.deepEqual(result.findings, []);
      assert.ok(result.lines.includes(`  allowed_peers in agent-manifest.json: "${served.origin}"`), result.out);
      assert.ok(result.lines.includes(`  tools of the calling agent: "${url}"`), result.out);
      assert.ok(result.lines.includes(`  link_labels in the .hocon: "${url}": "Harbor Tours Assistant" (suggested; write your own)`), result.out);
      assert.ok(result.lines.includes("  Tool name the model sees: harbor_tours"), result.out);
      assert.ok(result.lines.includes("Its front agent's instructions start: \"You answer questions about Harbor Tours' boat trips.\""), result.out);
      assert.ok(result.lines.includes("Add to this site:"), result.out);
      assert.ok(result.lines.includes("  - tours_assistant (front agent): model gpt-4.1-mini, max_steps 12"), result.out);
      assert.ok(result.lines.includes("      nothing beyond the partner's own agents"), result.out);
      assert.ok(result.lines.includes(`OK: ${url} can be called from http://localhost:8082.`), result.out);
      const paths = [];
      for (const request of served.server.requests) {
        assert.equal(request.origin, CheckPartnerTest.CALLER, request.path);
        paths.push(request.path);
      }
      assert.deepEqual(paths, [
        "/agent-manifest.json",
        "/harbor_tours.network.json",
        "/links.json",
        "/bridge/action-bridge.html",
        "/runtime/action-bridge.js",
        "/bridge/agent-manifest.json",
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A manifest with no CORS header, or one for another origin, fails. One for the caller passes.
   */
  static async testMissingCorsFails() {
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    delete routes["/agent-manifest.json"].headers["Access-Control-Allow-Origin"];
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 1);
      assert.deepEqual(served.result.findings, [
        `ERROR: The manifest at ${served.origin}/agent-manifest.json sends no Access-Control-Allow-Origin header, so a browser on another site cannot read it and the call fails with "Failed to fetch".`,
      ]);
      assert.ok(!served.result.out.includes("Add to this site:"), served.result.out);
      routes["/agent-manifest.json"].headers["Access-Control-Allow-Origin"] = "https://other.example";
      const other = await CheckPartnerTest.check([`${served.origin}/harbor_tours`, "--origin", CheckPartnerTest.CALLER], fetch);
      assert.equal(other.code, 1);
      assert.deepEqual(other.findings, [
        `ERROR: The manifest at ${served.origin}/agent-manifest.json sends Access-Control-Allow-Origin "https://other.example", which leaves out http://localhost:8082, so the call fails with "Failed to fetch".`,
      ]);
      routes["/agent-manifest.json"].headers["Access-Control-Allow-Origin"] = CheckPartnerTest.CALLER;
      const echoed = await CheckPartnerTest.check([`${served.origin}/harbor_tours`, "--origin", CheckPartnerTest.CALLER], fetch);
      assert.equal(echoed.code, 0, echoed.out);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A partner with actions but no bridge fails with the 10-second reason.
   */
  static async testMissingBridgeFails() {
    const manifest = CheckPartnerTest.manifest("skill");
    delete manifest.actions.bridge;
    const routes = await CheckPartnerTest.partnerRoutes("skill", manifest, CheckPartnerTest.network());
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 1);
      assert.deepEqual(served.result.findings, [
        "ERROR: The manifest has actions but no actions.bridge. A caller then waits 10 seconds, asks its visitor to open a popup, and the network never runs.",
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A URL whose last segment is not a published network fails and lists the names found.
   */
  static async testWrongNetworkNameFails() {
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tour");
    try {
      assert.equal(served.result.code, 1);
      assert.deepEqual(served.result.findings, [
        "ERROR: The manifest lists no network named \"harbor_tour\", and a caller never runs another one. It lists: harbor_tours.",
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A bridge page with X-Frame-Options: DENY fails, and so does a frame-ancestors policy
   * that leaves out the caller.
   */
  static async testFramingLimitsFail() {
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    routes["/bridge/action-bridge.html"].headers["X-Frame-Options"] = "DENY";
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      const page = `${served.origin}/bridge/action-bridge.html`;
      assert.equal(served.result.code, 1);
      assert.deepEqual(served.result.findings, [
        `ERROR: The bridge page at ${page} sends X-Frame-Options "DENY", so other sites cannot load it in a frame.`,
      ]);
      delete routes["/bridge/action-bridge.html"].headers["X-Frame-Options"];
      routes["/bridge/action-bridge.html"].headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'self'";
      const self = await CheckPartnerTest.check([`${served.origin}/harbor_tours`, "--origin", CheckPartnerTest.CALLER], fetch);
      assert.equal(self.code, 1);
      assert.deepEqual(self.findings, [
        `ERROR: The bridge page at ${page} sends a frame-ancestors policy that leaves out http://localhost:8082, so they cannot load it in a frame.`,
      ]);
      routes["/bridge/action-bridge.html"].headers["Content-Security-Policy"] = "frame-ancestors 'self' http://localhost:8082";
      const listed = await CheckPartnerTest.check([`${served.origin}/harbor_tours`, "--origin", CheckPartnerTest.CALLER], fetch);
      assert.equal(listed.code, 0, listed.out);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * frame-ancestors sources match the caller's origin as browsers match them.
   */
  static async testFrameAncestorsSources() {
    const cases = [
      ["frame-ancestors *", true],
      ["frame-ancestors 'none'", false],
      ["frame-ancestors 'self'", false],
      ["frame-ancestors http:", true],
      ["frame-ancestors https:", false],
      ["frame-ancestors http://localhost:8082", true],
      ["frame-ancestors http://localhost:*", true],
      ["frame-ancestors http://localhost", false],
      ["frame-ancestors localhost:8082", true],
      ["frame-ancestors https://*.example.com", false],
      ["default-src 'self'", true],
      ["frame-ancestors *, frame-ancestors 'self'", false],
    ];
    for (const [policy, allowed] of cases) {
      assert.equal(PartnerCheck.framingAllowed(policy, CheckPartnerTest.CALLER, "http://127.0.0.1:8080"), allowed, policy);
    }
    assert.equal(PartnerCheck.framingAllowed("frame-ancestors https://*.example.com", "https://www.example.com", "https://tours.example"), true);
    assert.equal(PartnerCheck.framingAllowed("frame-ancestors https://*.example.com", "https://example.com", "https://tours.example"), false);
    assert.equal(PartnerCheck.framingAllowed("frame-ancestors 'self'", "https://tours.example", "https://tours.example"), true);
  }

  /**
   * A redirect to another origin fails and names the target. One on the same origin warns
   * and is followed, as the runtime follows it.
   */
  static async testRedirects() {
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    const manifest = routes["/agent-manifest.json"];
    routes["/agent-manifest.json"] = {
      status: 302,
      headers: {
        Location: "https://elsewhere.example/agent-manifest.json",
      },
      body: "",
    };
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 1);
      assert.deepEqual(served.result.findings, [
        `ERROR: The manifest at ${served.origin}/agent-manifest.json redirects to another origin: https://elsewhere.example/agent-manifest.json.`,
      ]);
      routes["/agent-manifest.json"].headers.Location = "/v2/agent-manifest.json";
      routes["/v2/agent-manifest.json"] = manifest;
      const moved = await CheckPartnerTest.check([`${served.origin}/harbor_tours`, "--origin", CheckPartnerTest.CALLER], fetch);
      assert.equal(moved.code, 0, moved.out);
      assert.deepEqual(moved.findings, [
        `WARNING: The manifest at ${served.origin}/agent-manifest.json redirects to ${served.origin}/v2/agent-manifest.json. The runtime follows it.`,
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * An MCP server on the partner's own origin is marked "no consent card" and warns; one on
   * another origin asks the visitor first.
   */
  static async testOwnOriginMcpIsMarked() {
    const server = new BareServer({});
    const origin = await server.start();
    try {
      const network = CheckPartnerTest.network();
      network.tools[0].tools = [
        `${origin}/mcp`,
        "https://mcp.example/tools",
      ];
      server.routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), network);
      const result = await CheckPartnerTest.check([`${origin}/harbor_tours`, "--origin", CheckPartnerTest.CALLER], fetch);
      assert.equal(result.code, 0, result.out);
      assert.ok(result.lines.includes(`      MCP server ${origin}/mcp (on the partner's own origin: no consent card)`), result.out);
      assert.ok(result.lines.includes("      MCP server https://mcp.example/tools (asks the visitor first)"), result.out);
      assert.deepEqual(result.findings, [
        `WARNING: tours_assistant can send requests to ${origin}/mcp, an MCP server on the partner's own origin, with no consent card.`,
      ]);
    } finally {
      await server.stop();
    }
  }

  /**
   * A partner network on the caller's origin is marked as a call back the runtime skips.
   * One on another origin asks the visitor first.
   */
  static async testCallBackToCallerIsMarked() {
    const network = CheckPartnerTest.network();
    network.tools[0].tools = [
      `${CheckPartnerTest.CALLER}/visitor_desk`,
      "https://rooms.example/room_desk",
    ];
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), network);
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      const result = served.result;
      assert.equal(result.code, 0, result.out);
      assert.ok(result.lines.includes(`      partner network ${CheckPartnerTest.CALLER}/visitor_desk (on this site's origin: if it is this site's own network at a domain root, the runtime skips this call back)`), result.out);
      assert.ok(result.lines.includes("      partner network https://rooms.example/room_desk (asks the visitor first)"), result.out);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * With --origin set to the partner's own origin, a manifest with no CORS header passes,
   * so the check warns that it checked no CORS header.
   */
  static async testOwnOriginWarns() {
    const server = new BareServer({});
    const origin = await server.start();
    try {
      server.routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
      delete server.routes["/agent-manifest.json"].headers["Access-Control-Allow-Origin"];
      const result = await CheckPartnerTest.check([`${origin}/harbor_tours`, "--origin", origin], fetch);
      assert.equal(result.code, 0, result.out);
      assert.deepEqual(result.findings, [
        "WARNING: --origin is the partner's own origin, so no CORS header is checked. Leave out --origin, or pass another site's origin.",
      ]);
    } finally {
      await server.stop();
    }
  }

  /**
   * A partner whose front agent has no peer rule warns, and a long first line is cut.
   */
  static async testNoPeerRuleWarns() {
    const network = CheckPartnerTest.network();
    network.tools[0].instructions = `${"Tours. ".repeat(60)}\nAnswer questions.`;
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), network);
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      const result = served.result;
      assert.equal(result.code, 0, result.out);
      assert.deepEqual(result.findings, [
        "WARNING: The partner's front agent has no peer rule. With no website_* tools, the runtime's note tells it to report a missing integration, so it may answer only that.",
      ]);
      const opening = `Its front agent's instructions start: "${"Tours. ".repeat(60).trim().slice(0, 300)}…"`;
      assert.ok(result.lines.includes(opening), result.out);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * Without --origin, the check is of this site's own network, so the lines to add are
   * for a site that calls it.
   */
  static async testSelfCheckNamesCallers() {
    const server = new BareServer({});
    const origin = await server.start();
    try {
      server.routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
      const result = await CheckPartnerTest.check([`${origin}/harbor_tours`], fetch);
      assert.equal(result.code, 0, result.out);
      assert.ok(result.lines.includes("A site that calls this network adds:"), result.out);
      assert.ok(!result.lines.includes("Add to this site:"), result.out);
    } finally {
      await server.stop();
    }
  }

  /**
   * A link slot warns, bound by links.json or not, and the bound link is listed.
   */
  static async testLinkSlotsWarn() {
    const network = CheckPartnerTest.network();
    network.link_slots = {
      room_desk: {
        callers: [
          "tours_assistant",
        ],
      },
    };
    network.tools[0].tools = ["room_desk"];
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), network);
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 0, served.result.out);
      assert.ok(served.result.lines.includes("      link slot room_desk, not bound"), served.result.out);
      assert.deepEqual(served.result.findings, [
        "WARNING: tours_assistant uses link slot \"room_desk\": an unbound slot makes this site's chat ask the visitor for a URL.",
      ]);
      const links = {
        networks: {
          harbor_tours: {
            room_desk: "https://rooms.example/room_desk",
          },
        },
      };
      routes["/links.json"] = CheckPartnerTest.json(links, true);
      const bound = await CheckPartnerTest.check([`${served.origin}/harbor_tours`, "--origin", CheckPartnerTest.CALLER], fetch);
      assert.equal(bound.code, 0, bound.out);
      assert.ok(bound.lines.includes("      link slot room_desk, bound to https://rooms.example/room_desk"), bound.out);
      assert.ok(bound.lines.includes("  links.json: room_desk -> https://rooms.example/room_desk"), bound.out);
      assert.deepEqual(bound.findings, [
        "WARNING: tours_assistant uses link slot \"room_desk\", which links.json binds to https://rooms.example/room_desk. A bound slot allows that origin for the whole page.",
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A links.json that a caller cannot read only warns, because the runtime then ignores it.
   */
  static async testUnreadableLinksWarn() {
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    const links = {
      networks: {},
    };
    routes["/links.json"] = CheckPartnerTest.json(links, false);
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 0, served.result.out);
      assert.deepEqual(served.result.findings, [
        `WARNING: links.json at ${served.origin}/links.json sends no Access-Control-Allow-Origin header, so a browser on another site cannot read it and the call fails with "Failed to fetch". The runtime then ignores it.`,
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A partner without actions needs no bridge, so the check reads none.
   */
  static async testPartnerWithoutActionsNeedsNoBridge() {
    const manifest = CheckPartnerTest.manifest("skill");
    delete manifest.actions;
    const routes = await CheckPartnerTest.partnerRoutes("skill", manifest, CheckPartnerTest.network());
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 0, served.result.out);
      assert.deepEqual(served.result.findings, []);
      const paths = [];
      for (const request of served.server.requests) {
        paths.push(request.path);
      }
      assert.deepEqual(paths, [
        "/agent-manifest.json",
        "/harbor_tours.network.json",
        "/links.json",
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * An https partner works through a stand-in fetch, and every request asks for manual
   * redirects with the caller's Origin.
   */
  static async testHttpsPartnerThroughStubFetch() {
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    const calls = [];
    const stub = CheckPartnerTest.stubFetch.bind(null, routes, calls);
    const result = await CheckPartnerTest.check(["https://tours.example/harbor_tours", "--origin", CheckPartnerTest.CALLER], stub);
    assert.equal(result.code, 0, result.out);
    assert.deepEqual(result.findings, []);
    assert.ok(result.lines.includes("  allowed_peers in agent-manifest.json: \"https://tours.example\""), result.out);
    assert.ok(result.lines.includes("OK: https://tours.example/harbor_tours can be called from http://localhost:8082."), result.out);
    assert.equal(calls.length, 6);
    for (const call of calls) {
      assert.ok(call.url.startsWith("https://tours.example/"), call.url);
      assert.equal(call.init.redirect, "manual");
      assert.equal(call.init.headers.Origin, CheckPartnerTest.CALLER);
    }
  }

  /**
   * nsdeploy's layout, with the bridge next to the manifest, passes too.
   */
  static async testNsdeployBridgeLayoutPasses() {
    const routes = await CheckPartnerTest.partnerRoutes("nsdeploy", CheckPartnerTest.manifest("nsdeploy"), CheckPartnerTest.network());
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 0, served.result.out);
      assert.deepEqual(served.result.findings, []);
      const paths = [];
      for (const request of served.server.requests) {
        paths.push(request.path);
      }
      assert.deepEqual(paths, [
        "/agent-manifest.json",
        "/harbor_tours.network.json",
        "/links.json",
        "/action-bridge.html",
        "/runtime/action-bridge.js",
        "/agent-manifest.json",
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A bridge script served without a JavaScript type fails, because browsers will not run it.
   */
  static async testBridgeScriptTypeFails() {
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    routes["/runtime/action-bridge.js"].headers["Content-Type"] = "application/octet-stream";
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 1);
      assert.deepEqual(served.result.findings, [
        `ERROR: The bridge script at ${served.origin}/runtime/action-bridge.js is served as "application/octet-stream". Browsers run module scripts only with a JavaScript type, such as text/javascript.`,
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A network that fails the runtime's validation fails, because a caller would refuse it.
   */
  static async testInvalidNetworkFails() {
    const network = CheckPartnerTest.network();
    network.tools[0].tools = ["missing_helper"];
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), network);
    const served = await CheckPartnerTest.serveAndCheck(routes, "harbor_tours");
    try {
      assert.equal(served.result.code, 1);
      assert.deepEqual(served.result.findings, [
        "ERROR: The network file fails the runtime's validation, so a caller refuses to run it: Agent 'tours_assistant' references missing tool 'missing_helper'.",
      ]);
    } finally {
      await served.server.stop();
    }
  }

  /**
   * A URL that is not a full network URL fails before anything is fetched. Plain http fails
   * for any host but localhost and 127.0.0.1.
   */
  static async testBadUrlsFail() {
    const cases = [
      ["harbor_tours", "ERROR: harbor_tours is not a full http or https URL. Give the folder that holds the partner's agent-manifest.json, then its network name, such as https://partner.example/partner_network."],
      ["https://tours.example/harbor_tours/", "ERROR: https://tours.example/harbor_tours/ must end in the network name, with no \"/\" at the end, no query and no \"#\", such as https://partner.example/partner_network."],
      ["https://tours.example/harbor_tours?lang=en", "ERROR: https://tours.example/harbor_tours?lang=en must end in the network name, with no \"/\" at the end, no query and no \"#\", such as https://partner.example/partner_network."],
    ];
    const routes = await CheckPartnerTest.partnerRoutes("skill", CheckPartnerTest.manifest("skill"), CheckPartnerTest.network());
    for (const [url, expected] of cases) {
      const calls = [];
      const result = await CheckPartnerTest.check([url, "--origin", CheckPartnerTest.CALLER], CheckPartnerTest.stubFetch.bind(null, routes, calls));
      assert.equal(result.code, 1, url);
      assert.deepEqual(result.findings, [expected]);
      assert.equal(calls.length, 0, url);
    }
    const calls = [];
    const plain = await CheckPartnerTest.check(["http://tours.example/harbor_tours", "--origin", CheckPartnerTest.CALLER], CheckPartnerTest.stubFetch.bind(null, routes, calls));
    assert.equal(plain.code, 1);
    assert.deepEqual(plain.findings, [
      "ERROR: http://tours.example/harbor_tours uses http. Use https for every host but localhost and 127.0.0.1.",
    ]);
    const usage = await CheckPartnerTest.check(["https://tours.example/harbor_tours", "--origin", "tours"], fetch);
    assert.equal(usage.code, 2);
  }

  /**
   * A partner that is not running fails with a reason that says so, for localhost as well
   * as for 127.0.0.1.
   */
  static async testPartnerNotRunningFails() {
    const server = new BareServer({});
    const origin = await server.start();
    await server.stop();
    const port = new URL(origin).port;
    for (const host of ["localhost", "127.0.0.1"]) {
      const result = await CheckPartnerTest.check([`http://${host}:${port}/harbor_tours`, "--origin", CheckPartnerTest.CALLER], fetch);
      assert.equal(result.code, 1, host);
      assert.deepEqual(result.findings, [
        `ERROR: The manifest at http://${host}:${port}/agent-manifest.json cannot be fetched: nothing is listening there, so the partner's site may not be running.`,
      ]);
    }
  }

  /**
   * End to end: the fixture site built by build_network.mjs and served by serve_site.mjs
   * passes the check, run as a command.
   */
  static async testBuiltAndServedFixturePasses() {
    const folder = await mkdtemp(path.join(os.tmpdir(), "partner-site-"));
    let child = null;
    try {
      await cp(CheckPartnerTest.FIXTURE, folder, { recursive: true });
      await cp(path.join(CheckPartnerTest.SKILL, "runtime"), path.join(folder, "runtime"), { recursive: true });
      const built = spawnSync(process.execPath, [
        path.join(CheckPartnerTest.SKILL, "scripts", "build_network.mjs"),
        path.join(folder, "seaside_desk.hocon"),
        "--manifest",
        path.join(folder, "agent-manifest.json"),
      ], { encoding: "utf8" });
      assert.equal(built.status, 0, built.stdout);
      child = spawn(process.execPath, [path.join(CheckPartnerTest.SKILL, "scripts", "serve_site.mjs"), folder, "--port", "0"], {
        stdio: [
          "ignore",
          "pipe",
          "ignore",
        ],
      });
      let url = null;
      for await (const line of createInterface({ input: child.stdout })) {
        const match = line.match(/^Open (http:\/\/\S+)$/);
        if (match) {
          url = match[1];
          break;
        }
      }
      assert.ok(url, "serve_site.mjs printed no URL.");
      // The checker runs as its own process, as a skill user runs it, while the server keeps serving.
      const checked = spawn(process.execPath, [
        path.join(CheckPartnerTest.SKILL, "scripts", "check_partner.mjs"),
        `${url}seaside_desk`,
        "--origin",
        CheckPartnerTest.CALLER,
      ], {
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      });
      // Listen for the exit first: the process may end before its output is read.
      const exited = once(checked, "exit");
      const errors = [];
      checked.stderr.on("data", CheckPartnerTest.collect.bind(null, errors));
      let out = "";
      for await (const chunk of checked.stdout) {
        out += String(chunk);
      }
      const [code] = await exited;
      assert.equal(code, 0, `${out}${errors.join("")}`);
      assert.ok(out.includes(`OK: ${url}seaside_desk can be called from http://localhost:8082.`), out);
      assert.ok(out.includes("      partner network https://tours.example/harbor_tours (asks the visitor first)"), out);
    } finally {
      if (child !== null && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      await rm(folder, {
        recursive: true,
        force: true,
      });
    }
  }
}

test("a good partner passes and prints the lines to paste", CheckPartnerTest.testGoodPartnerPasses);
test("a manifest without CORS for the caller fails", CheckPartnerTest.testMissingCorsFails);
test("a partner with actions but no bridge fails", CheckPartnerTest.testMissingBridgeFails);
test("a wrong network name fails", CheckPartnerTest.testWrongNetworkNameFails);
test("X-Frame-Options and a narrow frame-ancestors fail", CheckPartnerTest.testFramingLimitsFail);
test("frame-ancestors sources match like a browser", CheckPartnerTest.testFrameAncestorsSources);
test("a cross-origin redirect fails and a same-origin one warns", CheckPartnerTest.testRedirects);
test("an MCP server on the partner's own origin is marked no consent card", CheckPartnerTest.testOwnOriginMcpIsMarked);
test("a call back to the caller's origin is marked as skipped", CheckPartnerTest.testCallBackToCallerIsMarked);
test("--origin equal to the partner's own origin warns", CheckPartnerTest.testOwnOriginWarns);
test("a partner with no peer rule warns, and the start of its instructions is printed", CheckPartnerTest.testNoPeerRuleWarns);
test("a check with no --origin prints the lines for a calling site", CheckPartnerTest.testSelfCheckNamesCallers);
test("link slots warn", CheckPartnerTest.testLinkSlotsWarn);
test("a links.json that callers cannot read only warns", CheckPartnerTest.testUnreadableLinksWarn);
test("a partner without actions needs no bridge", CheckPartnerTest.testPartnerWithoutActionsNeedsNoBridge);
test("an https partner passes through a stand-in fetch", CheckPartnerTest.testHttpsPartnerThroughStubFetch);
test("the nsdeploy bridge layout passes", CheckPartnerTest.testNsdeployBridgeLayoutPasses);
test("a bridge script without a JavaScript type fails", CheckPartnerTest.testBridgeScriptTypeFails);
test("a network that fails validation fails", CheckPartnerTest.testInvalidNetworkFails);
test("bad partner URLs fail before any fetch", CheckPartnerTest.testBadUrlsFail);
test("a partner that is not running fails with that reason", CheckPartnerTest.testPartnerNotRunningFails);
test("the built and served fixture passes as a command", CheckPartnerTest.testBuiltAndServedFixturePasses);

// Checks skills/agentify-website/scripts/serve_site.mjs on a small temp site.
// Run from the repository root: node --test "tests/skills/agentify-website/scripts/*.test.mjs"
// Each test starts the real script on 127.0.0.1 with a free port, and stops it afterwards.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Starts serve_site.mjs on a temp site and checks what it sends.
 *
 * A host for an agent site must send the CORS header on the public files and nothing that
 * blocks framing. These tests check that the server sends exactly that, and that its log
 * keeps no header values.
 */
class ServeSiteTest {
  /**
   * The script under test.
   */
  static SCRIPT = fileURLToPath(new URL("../../../../skills/agentify-website/scripts/serve_site.mjs", import.meta.url));

  /**
   * The temp site's manifest. The server reads the network file and protocol name from it.
   */
  static MANIFEST = {
    networks: [
      {
        name: "desk",
        hocon: "./desk.network.json",
      },
    ],
    linking: {
      protocol: "nsdeploy-link/v1",
    },
  };

  /**
   * The temp site's other files, by path, with their text.
   */
  static FILES = {
    "desk.network.json": "{}",
    "links.json": "{}",
    "agent-mcp.json": "{}",
    ".well-known/nsdeploy.json": "{}",
    ".well-known/nsdeploy-agent.json": "{}",
    "index.html": "<!doctype html><title>Desk</title>",
    "styles.css": "body {}",
    "favicon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    "site-actions.js": "export function registerActions() {}",
    "js/data.mjs": "export const OPEN = true;",
    "runtime/sandbox-worker.js": "// worker",
    "runtime/action-bridge.js": "// bridge",
    "bridge/action-bridge.html": "<!doctype html><title>Action bridge</title>",
    "bridge/agent-manifest.json": "{}",
  };

  /**
   * The files that must get Access-Control-Allow-Origin: *.
   */
  static PUBLIC = [
    "/agent-manifest.json",
    "/desk.network.json",
    "/links.json",
    "/agent-mcp.json",
    "/.well-known/nsdeploy.json",
    "/.well-known/nsdeploy-agent.json",
  ];

  /**
   * Files that must not get it, including the bridge.
   */
  static PRIVATE = [
    "/",
    "/index.html",
    "/styles.css",
    "/favicon.svg",
    "/site-actions.js",
    "/js/data.mjs",
    "/runtime/sandbox-worker.js",
    "/runtime/action-bridge.js",
    "/bridge/action-bridge.html",
    "/bridge/agent-manifest.json",
  ];

  /**
   * A text that sits next to the site folder, where the server must never reach.
   */
  static SECRET = "not for the web";

  /**
   * Write the temp site, with a secret file just outside it.
   *
   * :return: The temp root, the site folder in it and a log path.
   */
  static async makeSite() {
    const root = await mkdtemp(path.join(os.tmpdir(), "serve-site-"));
    const site = path.join(root, "site");
    for (const [name, text] of Object.entries(ServeSiteTest.FILES)) {
      const file = path.join(site, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
    await writeFile(path.join(site, "agent-manifest.json"), JSON.stringify(ServeSiteTest.MANIFEST, null, 2));
    await writeFile(path.join(root, "secret.txt"), ServeSiteTest.SECRET);
    return {
      root: root,
      site: site,
      log: path.join(root, "requests.jsonl"),
    };
  }

  /**
   * Keep a chunk of a child's output.
   *
   * :param chunks: The list to add to.
   * :param chunk: The chunk.
   */
  static collect(chunks, chunk) {
    chunks.push(String(chunk));
  }

  /**
   * Start the server and wait for the line it prints.
   *
   * :param args: The arguments after the script name.
   * :return: The child process and the URL it printed.
   * :raises Error: When the server exits without printing the URL.
   */
  static async startServer(args) {
    const child = spawn(process.execPath, [ServeSiteTest.SCRIPT].concat(args), {
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    });
    const errors = [];
    child.stderr.on("data", ServeSiteTest.collect.bind(null, errors));
    for await (const line of createInterface({ input: child.stdout })) {
      const match = line.match(/^Open (http:\/\/\S+)$/);
      if (match) {
        return {
          child: child,
          url: match[1],
          port: Number(new URL(match[1]).port),
        };
      }
    }
    throw new Error(`The server printed no URL. Its errors: ${errors.join("")}`);
  }

  /**
   * Stop a server started by startServer.
   *
   * :param server: The started server, or null.
   */
  static async stopServer(server) {
    if (server === null || server.child.exitCode !== null || server.child.signalCode !== null) {
      return;
    }
    const exited = once(server.child, "exit");
    server.child.kill();
    await exited;
  }

  /**
   * Start a server on a new temp site, on 127.0.0.1 and a free port, with a log.
   *
   * :return: The temp site and the started server.
   */
  static async serveSite() {
    const site = await ServeSiteTest.makeSite();
    const server = await ServeSiteTest.startServer([site.site, "--port", "0", "--log", site.log]);
    return {
      site: site,
      server: server,
    };
  }

  /**
   * Stop the server and delete its temp site.
   *
   * :param served: The value serveSite returned, or null.
   */
  static async cleanUp(served) {
    if (served === null) {
      return;
    }
    await ServeSiteTest.stopServer(served.server);
    await rm(served.site.root, {
      recursive: true,
      force: true,
    });
  }

  /**
   * Fetch one path from a started server.
   *
   * :param server: The started server.
   * :param urlPath: The path, such as "/index.html".
   * :param headers: Request headers.
   * :return: The response, with its text read.
   */
  static async get(server, urlPath, headers) {
    const response = await fetch(`http://127.0.0.1:${server.port}${urlPath}`, {
      headers: headers,
      redirect: "manual",
    });
    return {
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    };
  }

  /**
   * Send a raw GET, so the path reaches the server exactly as written.
   *
   * :param server: The started server.
   * :param rawPath: The path, which fetch would normalize.
   * :return: The status and the body text.
   */
  static async rawGet(server, rawPath) {
    const request = http.get({
      host: "127.0.0.1",
      port: server.port,
      path: rawPath,
    });
    const [response] = await once(request, "response");
    let text = "";
    for await (const chunk of response) {
      text += String(chunk);
    }
    return {
      status: response.statusCode,
      text: text,
    };
  }

  /**
   * Only the public files get Access-Control-Allow-Origin: *. The bridge folder gets none.
   */
  static async testCorsOnPublicFilesOnly() {
    let served = null;
    try {
      served = await ServeSiteTest.serveSite();
      for (const urlPath of ServeSiteTest.PUBLIC) {
        const response = await ServeSiteTest.get(served.server, urlPath, {});
        assert.equal(response.status, 200, urlPath);
        assert.equal(response.headers.get("access-control-allow-origin"), "*", urlPath);
      }
      for (const urlPath of ServeSiteTest.PRIVATE) {
        const response = await ServeSiteTest.get(served.server, urlPath, {});
        assert.equal(response.status, 200, urlPath);
        assert.equal(response.headers.get("access-control-allow-origin"), null, urlPath);
      }
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * The coded-tool worker gets its Content-Security-Policy, and no other file gets one.
   */
  static async testWorkerPolicy() {
    let served = null;
    try {
      served = await ServeSiteTest.serveSite();
      const worker = await ServeSiteTest.get(served.server, "/runtime/sandbox-worker.js", {});
      assert.equal(worker.headers.get("content-security-policy"), "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'");
      for (const urlPath of ServeSiteTest.PUBLIC.concat(["/index.html", "/bridge/action-bridge.html"])) {
        const response = await ServeSiteTest.get(served.server, urlPath, {});
        assert.equal(response.headers.get("content-security-policy"), null, urlPath);
      }
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * No response limits framing, so callers can load the bridge, and none may be cached.
   */
  static async testNoFramingLimitsAndNoCache() {
    let served = null;
    try {
      served = await ServeSiteTest.serveSite();
      for (const urlPath of ServeSiteTest.PUBLIC.concat(ServeSiteTest.PRIVATE, ["/missing.html"])) {
        const response = await ServeSiteTest.get(served.server, urlPath, {});
        assert.equal(response.headers.get("x-frame-options"), null, urlPath);
        assert.ok(!String(response.headers.get("content-security-policy")).includes("frame-ancestors"), urlPath);
        assert.equal(response.headers.get("cache-control"), "no-store", urlPath);
      }
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * A path that leaves the site folder is refused, also through a link inside it.
   */
  static async testPathOutsideFolderRefused() {
    let served = null;
    try {
      served = await ServeSiteTest.serveSite();
      await symlink(path.join(served.site.root, "secret.txt"), path.join(served.site.site, "link.txt"));
      const encoded = await ServeSiteTest.get(served.server, "/..%2fsecret.txt", {});
      assert.equal(encoded.status, 403);
      assert.ok(!encoded.text.includes(ServeSiteTest.SECRET));
      const linked = await ServeSiteTest.get(served.server, "/link.txt", {});
      assert.equal(linked.status, 403);
      assert.ok(!linked.text.includes(ServeSiteTest.SECRET));
      // A plain "../" stays inside: the URL parser drops it before the server looks.
      const raw = await ServeSiteTest.rawGet(served.server, "/../secret.txt");
      assert.equal(raw.status, 404);
      assert.ok(!raw.text.includes(ServeSiteTest.SECRET));
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * Files get the right content types, and a folder gets its index.html after a slash.
   */
  static async testContentTypes() {
    const types = {
      "/index.html": "text/html; charset=utf-8",
      "/site-actions.js": "text/javascript; charset=utf-8",
      "/js/data.mjs": "text/javascript; charset=utf-8",
      "/agent-manifest.json": "application/json; charset=utf-8",
      "/styles.css": "text/css; charset=utf-8",
      "/favicon.svg": "image/svg+xml",
      "/": "text/html; charset=utf-8",
    };
    let served = null;
    try {
      served = await ServeSiteTest.serveSite();
      for (const [urlPath, type] of Object.entries(types)) {
        const response = await ServeSiteTest.get(served.server, urlPath, {});
        assert.equal(response.status, 200, urlPath);
        assert.equal(response.headers.get("content-type"), type, urlPath);
      }
      const folder = await ServeSiteTest.get(served.server, "/bridge", {});
      assert.equal(folder.status, 301);
      assert.equal(folder.headers.get("location"), "/bridge/");
      const missing = await ServeSiteTest.get(served.server, "/missing.html", {});
      assert.equal(missing.status, 404);
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * The log names the Origin, whether Authorization was sent and the cookie names, but no
   * key, cookie value or query.
   */
  static async testLogHoldsNoHeaderValues() {
    let served = null;
    try {
      served = await ServeSiteTest.serveSite();
      await ServeSiteTest.get(served.server, "/agent-manifest.json?key=sk-test-not-a-real-key", {
        Origin: "http://localhost:8082",
        Authorization: "Bearer sk-test-not-a-real-key",
        Cookie: "nsweb_byok_profiles_v1=saved-profile-with-key; theme=dark",
      });
      await ServeSiteTest.get(served.server, "/index.html", {});
      const text = await readFile(served.site.log, "utf8");
      assert.ok(!text.includes("sk-test-not-a-real-key"));
      assert.ok(!text.includes("saved-profile-with-key"));
      assert.ok(!text.includes("dark"));
      const lines = text.trim().split("\n");
      assert.equal(lines.length, 2);
      const first = JSON.parse(lines[0]);
      assert.equal(typeof first.time, "number");
      delete first.time;
      assert.deepEqual(first, {
        method: "GET",
        path: "/agent-manifest.json",
        status: 200,
        origin: "http://localhost:8082",
        authorization: true,
        cookies: [
          "nsweb_byok_profiles_v1",
          "theme",
        ],
      });
      const second = JSON.parse(lines[1]);
      delete second.time;
      assert.deepEqual(second, {
        method: "GET",
        path: "/index.html",
        status: 200,
        origin: null,
        authorization: false,
        cookies: [],
      });
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * --open-as changes only the printed host name. The server still listens on --host.
   */
  static async testOpenAsChangesOnlyTheUrl() {
    const site = await ServeSiteTest.makeSite();
    let server = null;
    let plain = null;
    try {
      server = await ServeSiteTest.startServer([site.site, "--host", "127.0.0.1", "--port", "0", "--open-as", "localhost"]);
      assert.equal(server.url, `http://localhost:${server.port}/`);
      const page = await ServeSiteTest.get(server, "/", {});
      assert.equal(page.status, 200);
      plain = await ServeSiteTest.startServer([site.site, "--port", "0"]);
      assert.equal(plain.url, `http://127.0.0.1:${plain.port}/`);
      const help = spawnSync(process.execPath, [ServeSiteTest.SCRIPT, "--help"], { encoding: "utf8" });
      assert.equal(help.status, 0);
      assert.ok(help.stdout.includes("Use it when two linked sites run on one machine: open one as 127.0.0.1 and the other as localhost."), help.stdout);
    } finally {
      await ServeSiteTest.stopServer(server);
      await ServeSiteTest.stopServer(plain);
      await rm(site.root, {
        recursive: true,
        force: true,
      });
    }
  }

  /**
   * The facts export, as templates/agent-manifest.json writes it.
   */
  static FACTS_EXPORT = {
    network: "desk_facts",
    front_man: "facts_assistant",
    aliases: [
      "desk_facts",
    ],
    url: "facts/desk_facts",
  };

  /**
   * Write a temp site with a facts folder, and start the server on it.
   *
   * :param exports: The root manifest's linking.exports list.
   * :param factsHocon: The network file the facts folder's manifest names.
   * :return: The temp site and the started server, as serveSite gives them.
   */
  static async serveFactsSite(exports, factsHocon) {
    const site = await ServeSiteTest.makeSite();
    const manifest = structuredClone(ServeSiteTest.MANIFEST);
    manifest.linking.exports = exports;
    await writeFile(path.join(site.site, "agent-manifest.json"), JSON.stringify(manifest, null, 2));
    const factsManifest = {
      networks: [
        {
          name: "desk_facts",
          front_man: "facts_assistant",
          hocon: factsHocon,
          tags: [
            "public-facts",
          ],
        },
      ],
      allowed_peers: [],
    };
    const files = {
      "agent-facts.mjs": "export class AgentFacts {}",
      "facts/agent-manifest.json": JSON.stringify(factsManifest, null, 2),
      "facts/desk_facts.network.json": "{}",
      "facts/links.json": "{}",
      "facts/notes.txt": "not public",
      "up/agent-manifest.json": "{}",
    };
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(site.site, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
    const server = await ServeSiteTest.startServer([site.site, "--port", "0"]);
    return {
      site: site,
      server: server,
    };
  }

  /**
   * Give the CORS header one path gets, or null.
   *
   * :param server: The started server.
   * :param urlPath: The path.
   * :return: The Access-Control-Allow-Origin value, or null.
   */
  static async cors(server, urlPath) {
    const response = await ServeSiteTest.get(server, urlPath, {
      Origin: "http://localhost:8081",
    });
    return response.headers.get("access-control-allow-origin");
  }

  /**
   * A facts export makes its folder's manifest, links.json and network file public, and
   * nothing else in that folder, nor agent-facts.mjs.
   */
  static async testFactsFilesGetCors() {
    let served = null;
    try {
      served = await ServeSiteTest.serveFactsSite([ServeSiteTest.FACTS_EXPORT], "./desk_facts.network.json");
      for (const urlPath of ["/facts/agent-manifest.json", "/facts/desk_facts.network.json", "/facts/links.json"]) {
        assert.equal(await ServeSiteTest.cors(served.server, urlPath), "*", urlPath);
      }
      for (const urlPath of ["/agent-facts.mjs", "/facts/notes.txt", "/up/agent-manifest.json", "/bridge/agent-manifest.json"]) {
        assert.equal(await ServeSiteTest.cors(served.server, urlPath), null, urlPath);
      }
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * Export URLs at the root, on another host, absolute on this host, or with dot segments
   * add no folder. A facts manifest that names "../index.html" does not make it public.
   */
  static async testOddExportsAddNothing() {
    const exports = [
      {
        url: "desk",
      },
      {
        url: "https://other.example/up/x",
      },
      {
        url: "/up/x",
      },
      {
        url: "../up/x",
      },
      {
        url: "facts/../up/x",
      },
      {
        url: "facts/desk_facts",
      },
    ];
    let served = null;
    try {
      served = await ServeSiteTest.serveFactsSite(exports, "../index.html");
      assert.equal(await ServeSiteTest.cors(served.server, "/up/agent-manifest.json"), null);
      assert.equal(await ServeSiteTest.cors(served.server, "/index.html"), null);
      assert.equal(await ServeSiteTest.cors(served.server, "/facts/agent-manifest.json"), "*");
      assert.equal(await ServeSiteTest.cors(served.server, "/facts/desk_facts.network.json"), null);
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * A facts export added while the server runs is picked up on the next request.
   */
  static async testExportAddedWhileRunning() {
    let served = null;
    try {
      served = await ServeSiteTest.serveFactsSite([], "./desk_facts.network.json");
      assert.equal(await ServeSiteTest.cors(served.server, "/facts/desk_facts.network.json"), null);
      const manifest = structuredClone(ServeSiteTest.MANIFEST);
      manifest.linking.exports = [ServeSiteTest.FACTS_EXPORT];
      await writeFile(path.join(served.site.site, "agent-manifest.json"), JSON.stringify(manifest, null, 2));
      assert.equal(await ServeSiteTest.cors(served.server, "/facts/desk_facts.network.json"), "*");
    } finally {
      await ServeSiteTest.cleanUp(served);
    }
  }

  /**
   * The hosting guide's _headers block names the three facts files, and its Apache
   * pattern matches the facts network file, so a host serves what the server serves.
   */
  static async testHostingGuideNamesTheFacts() {
    const guide = await readFile(new URL("../../../../skills/agentify-website/references/bundle_and_hosting.md", import.meta.url), "utf8");
    for (const line of ["/facts/agent-manifest.json", "/facts/<network>_facts.network.json", "/facts/links.json"]) {
      assert.ok(guide.includes(`${line}\n  Access-Control-Allow-Origin: *`), `The _headers block lacks ${line}.`);
    }
    const match = /<FilesMatch "([^"]+)">/.exec(guide);
    assert.ok(match, "The guide has no Apache FilesMatch line.");
    const pattern = new RegExp(match[1].replaceAll("<network>", "desk").replaceAll("<protocol_name>", "nsdeploy"));
    for (const file of ["agent-manifest.json", "desk.network.json", "desk_facts.network.json", "links.json"]) {
      assert.ok(pattern.test(file), file);
    }
    for (const file of ["agent-facts.mjs", "index.html", "action-bridge.html", "sandbox-worker.js"]) {
      assert.ok(!pattern.test(file), file);
    }
  }
}

test("only the public files get the CORS header", ServeSiteTest.testCorsOnPublicFilesOnly);
test("the sandbox worker gets its Content-Security-Policy", ServeSiteTest.testWorkerPolicy);
test("nothing limits framing and nothing is cached", ServeSiteTest.testNoFramingLimitsAndNoCache);
test("paths outside the site folder are refused", ServeSiteTest.testPathOutsideFolderRefused);
test("files get the right content types", ServeSiteTest.testContentTypes);
test("the log holds no header values", ServeSiteTest.testLogHoldsNoHeaderValues);
test("--open-as changes only the printed URL", ServeSiteTest.testOpenAsChangesOnlyTheUrl);
test("a facts export's three files get the CORS header, and nothing else new", ServeSiteTest.testFactsFilesGetCors);
test("odd export URLs and a ../ network file add nothing", ServeSiteTest.testOddExportsAddNothing);
test("a facts export added while the server runs is picked up", ServeSiteTest.testExportAddedWhileRunning);
test("the hosting guide names the facts files the server serves", ServeSiteTest.testHostingGuideNamesTheFacts);

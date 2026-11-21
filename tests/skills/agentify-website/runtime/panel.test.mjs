// Checks the ⚙ AI model settings panel in headless Chrome, on a site whose default router
// is publisher-funded (runtime/README.md, "Publisher-funded router"): a visitor's key that
// the panel does not recognize is saved, and no request to the funded router carries it.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The routers are local fakes and the key is made up. Without Chrome the test is skipped.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CdpClient } from "../../../linking/chrome/cdp_client.mjs";
import { ChromeLauncher } from "../../../linking/chrome/chrome_launcher.mjs";
import { PageScripts } from "../../../linking/chrome/page_scripts.mjs";

/**
 * Serves the guesthouse example with a publisher-funded router, opens it in Chrome, and
 * saves an unrecognized key in the panel.
 *
 * One local server stands in for both routers: `/funded/v1` is the router the site pays
 * for, `/byok/v1` the router for visitors' own keys. It keeps each request's path and
 * whether it carried the key, never the key itself.
 */
class PanelKeyTest {
  static REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  // A self-hosted Otari key: no provider in the panel's list matches it.
  static KEY = `tk-${"x".repeat(48)}`;
  static SITE_PORT = 8796;
  static DEVTOOLS_PORT = 9786;

  /**
   * Start the fake routers on a free port.
   *
   * :return: The server, its base URL and the request records.
   */
  static async routers() {
    const records = [];
    const server = http.createServer(PanelKeyTest.answer.bind(null, records));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {server, base: `http://127.0.0.1:${server.address().port}`, records};
  }

  /**
   * Record a request and answer it: CORS preflights, a model list, or a one-chunk chat reply.
   *
   * :param records: Where the request is recorded.
   * :param req: The request.
   * :param res: The response.
   */
  static answer(records, req, res) {
    const body = [];
    req.on("data", (chunk) => body.push(chunk));
    req.on("end", () => {
      const text = `${JSON.stringify(req.headers)} ${Buffer.concat(body).toString("utf8")}`;
      records.push({method: req.method, path: req.url, key: text.includes(PanelKeyTest.KEY)});
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
      } else if (req.url.endsWith("/models")) {
        res.writeHead(200, {"Content-Type": "application/json"}).end(JSON.stringify({data: [{id: "alibaba/qwen3.8-flash"}]}));
      } else {
        const chunk = {model: "alibaba/qwen3.8-flash", choices: [{delta: {content: "Hello."}, finish_reason: "stop"}]};
        res.writeHead(200, {"Content-Type": "text/event-stream"}).end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      }
    });
  }

  /**
   * Copy the guesthouse example and make its default router publisher-funded.
   *
   * :param out: The temp folder.
   * :param base: The fake routers' base URL.
   * :return: The site folder.
   */
  static async site(out, base) {
    const folder = path.join(out, "site");
    await cp(path.join(PanelKeyTest.REPO, "examples", "guesthouse_agentified"), folder, {recursive: true});
    const file = path.join(folder, "agent-manifest.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.llm_router = {base_url: `${base}/funded/v1`, publisher_funded: true, mock: false, byok_router: `${base}/byok/v1`};
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    return folder;
  }

  /**
   * Serve the site with the skill's serve_site.mjs, and wait for its "Open" line.
   *
   * :param folder: The site folder.
   * :return: The server process.
   */
  static async serve(folder) {
    const script = path.join(PanelKeyTest.REPO, "skills", "agentify-website", "scripts", "serve_site.mjs");
    const child = spawn(process.execPath, [script, folder, "--host", "127.0.0.1", "--port", String(PanelKeyTest.SITE_PORT)],
      {stdio: ["ignore", "pipe", "inherit"]});
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => String(chunk).includes("Open ") && resolve());
      child.on("exit", (code) => reject(new Error(`serve_site.mjs exited with ${code}`)));
    });
    return child;
  }

  /**
   * Evaluate a page script until its value is truthy.
   *
   * :param client: The CdpClient.
   * :param session: The page's session.
   * :param expression: The script.
   * :param label: What is awaited, for the error.
   */
  static async waitFor(client, session, expression, label) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await client.evaluate(session, expression).catch(() => false)) return;
      await CdpClient.sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  /**
   * Save an unrecognized key and a model with the Provider URL the panel shows, then send
   * a message.
   * The funded router gets requests, but none with the key, and the key goes to byok_router.
   */
  static async testUnknownKeyNeverReachesFundedRouter() {
    const out = await mkdtemp(path.join(os.tmpdir(), "panel-key-"));
    const routers = await PanelKeyTest.routers();
    let server = null;
    let chrome = null;
    let client = null;
    try {
      server = await PanelKeyTest.serve(await PanelKeyTest.site(out, routers.base));
      chrome = new ChromeLauncher(ChromeLauncher.locate(process.env.CHROME), PanelKeyTest.DEVTOOLS_PORT,
        path.join(out, "profile"), path.join(out, "chrome.log"));
      await chrome.start();
      client = await CdpClient.connect(PanelKeyTest.DEVTOOLS_PORT);
      const {targetId} = await client.send("Target.createTarget", {url: "about:blank"});
      const {sessionId} = await client.send("Target.attachToTarget", {targetId, flatten: true});
      await client.send("Page.navigate", {url: `http://127.0.0.1:${PanelKeyTest.SITE_PORT}/`}, sessionId);
      await PanelKeyTest.waitFor(client, sessionId, PageScripts.ready(), "the runtime to boot");

      const before = await client.evaluate(sessionId, `document.querySelector("#ns-router").value`);
      assert.equal(before, `${routers.base}/funded/v1`, "The Provider URL box does not start at base_url.");
      // Type the key as a visitor does, and keep whatever Provider URL the panel then shows.
      const shown = await client.evaluate(sessionId, `{
  const key = document.querySelector("#ns-key");
  key.value = ${JSON.stringify(PanelKeyTest.KEY)};
  key.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("#ns-router").value;
}`);
      assert.equal(shown, "", "The panel kept base_url in the Provider URL box for an unknown key.");
      // A model makes Save and start check the provider's model list, which sends the key.
      await client.evaluate(sessionId, `{
  const model = document.querySelector("#ns-model");
  model.value = "alibaba/qwen3.8-flash";
  model.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("#ns-apply").click();
  true;
}`);
      await PanelKeyTest.waitFor(client, sessionId, PageScripts.keyApplied(PanelKeyTest.KEY), "the reload with the key");
      await client.evaluate(sessionId, PageScripts.send("Hello"));
      const deadline = Date.now() + 10000;
      while (!routers.records.some((r) => r.path.startsWith("/byok/") && r.method === "POST") && Date.now() < deadline) {
        await CdpClient.sleep(100);
      }

      const funded = routers.records.filter((r) => r.path.startsWith("/funded/"));
      assert.deepEqual(funded.filter((r) => r.key), [], "A request to the publisher-funded router carried the key.");
      const chat = routers.records.filter((r) => r.path === "/byok/v1/chat/completions" && r.method === "POST");
      assert.ok(chat.length >= 1 && chat.every((r) => r.key), "The chat did not send the key to byok_router.");
    } finally {
      client?.close();
      await chrome?.stop();
      server?.kill();
      routers.server.close();
      await rm(out, {recursive: true, force: true});
    }
  }
}

const chromeFound = (() => {
  try {
    return !!ChromeLauncher.locate(process.env.CHROME);
  } catch {
    return false;
  }
})();
test("an unknown key saved in the panel never reaches the publisher-funded router",
  {skip: chromeFound ? false : "Chrome is not installed; set CHROME to its binary to run this check."},
  PanelKeyTest.testUnknownKeyNeverReachesFundedRouter);

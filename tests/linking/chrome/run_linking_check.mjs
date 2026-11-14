// Runs the two-host headless Chrome check of linked sites with a mock router, then stops
// every process it started.
//
// Usage, from the repository root:
//   node tests/linking/chrome/run_linking_check.mjs [--chrome <path>]
//        [--direction both|caller-to-gh|gh-to-tours|tours-to-gh] [--same-host] [--no-bridge]
//        [--guesthouse <folder>] [--tours <folder>] [--out <folder>]
//
// It serves each site with the skill's serve_site.mjs on its local address, runs the router
// on 127.0.0.1:8791 and Chrome's DevTools on port 9782, and writes its output to a new temp
// folder outside the repository. See tests/linking/README.md.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentNetwork } from "../../../skills/agentify-website/runtime/kernel.js";
import { CdpClient } from "./cdp_client.mjs";
import { ChromeLauncher } from "./chrome_launcher.mjs";
import { LinkCallRun } from "./link_call_run.mjs";
import { MockRouter } from "./mock_router.mjs";
import { PageScripts } from "./page_scripts.mjs";

/**
 * Starts the sites, the router and Chrome, runs the cases, writes the report, and stops
 * everything, also on failure or Ctrl+C.
 *
 * Each direction runs C1 (C4 when the tour site calls), C2 and C3, and C7 with
 * --same-host. Each served site then gets C5 and C6, and C8 runs last with --no-bridge,
 * for the first direction. A direction skips, with the reason, only while the real tour
 * site does not exist. A direction whose sites are not linked fails. The exit code is 0
 * when every case that ran passed, 1 when one failed, and 2 when the check could not
 * start or stopped on an error. C7 and C8 only report.
 */
class LinkingCheck {
  /**
   * The repository root.
   */
  static REPO = fileURLToPath(new URL("../../../", import.meta.url));

  /**
   * The fake key. Only the mock router should see it.
   */
  static KEY = "sk-test-not-a-real-key";

  /**
   * A model the visitor picks, which no site names.
   */
  static VISITOR_MODEL = "gpt-5.2";

  /**
   * The router's port on 127.0.0.1.
   */
  static ROUTER_PORT = 8791;

  /**
   * Chrome's DevTools port.
   */
  static DEVTOOLS_PORT = 9782;

  /**
   * The cookie in which the runtime mirrors saved keys on loopback hosts (runtime/byok.js).
   */
  static COOKIE = "nsweb_byok_profiles_v1";

  /**
   * How long one visitor turn may take.
   */
  static TURN_TIMEOUT_MS = 60000;

  /**
   * How long the whole check may take before it stops everything.
   */
  static RUN_TIMEOUT_MS = 600000;

  /**
   * Each site's port and the host name it is opened as. Every server binds 127.0.0.1.
   */
  static SITES = {
    guesthouse: {
      port: 8080,
      host: "127.0.0.1",
      title: "guesthouse",
    },
    tours: {
      port: 8081,
      host: "localhost",
      title: "tour site",
    },
    caller: {
      port: 8082,
      host: "localhost",
      title: "fixture caller",
    },
  };

  /**
   * Each direction: who calls whom, the partner's network URL, the visitor's message and
   * the request the calling site sends. Each request is under 140 characters. Each site
   * names its partner's facts network (facts/<network>_facts): one tool-free agent, no
   * bridge. C9 calls the guesthouse's main network once, so the bridge keeps a check.
   */
  static DIRECTIONS = {
    "caller-to-gh": {
      caller: "caller",
      partner: "guesthouse",
      partnerUrl: "http://127.0.0.1:8080/facts/tidewhistle_guesthouse_facts",
      facts: true,
      message: "Can you ask Tidewhistle Guesthouse whether a step-free room is free for two from 12 to 14 June?",
      request: "Is a step-free room free for two adults from 12 to 14 June, and what would it cost?",
    },
    "gh-to-tours": {
      caller: "guesthouse",
      partner: "tours",
      partnerUrl: "http://localhost:8081/facts/marrow_point_harbor_tours_facts",
      facts: true,
      message: "Are there boat trips from the harbor while we stay, from 12 to 14 June?",
      request: "Is there a boat trip for two adults between 12 and 14 June, and what does it cost?",
    },
    "tours-to-gh": {
      caller: "tours",
      partner: "guesthouse",
      partnerUrl: "http://127.0.0.1:8080/facts/tidewhistle_guesthouse_facts",
      facts: true,
      message: "Where can we stay in Marrow Point from 12 to 14 June?",
      request: "Is a room free for two adults from 12 to 14 June, and what would it cost?",
    },
  };

  /**
   * C9: the test caller, served naming the guesthouse's main network in place of its
   * facts network, so the bridge path keeps a browser check.
   */
  static MAIN_URL_CASE = {
    caller: "caller",
    partner: "guesthouse",
    partnerUrl: "http://127.0.0.1:8080/tidewhistle_guesthouse",
    listedUrl: "http://127.0.0.1:8080/facts/tidewhistle_guesthouse_facts",
    facts: false,
    message: "Can you ask Tidewhistle Guesthouse whether a step-free room is free for two from 12 to 14 June?",
    request: "Is a step-free room free for two adults from 12 to 14 June, and what would it cost?",
  };

  /**
   * The usage text, printed for --help and after a bad argument.
   */
  static USAGE = [
    "Usage: node tests/linking/chrome/run_linking_check.mjs [options]",
    "  --chrome <path>      The Chrome binary. Default: CHROME, then the usual install paths.",
    "  --direction <name>   both (default), caller-to-gh, gh-to-tours or tours-to-gh.",
    "  --same-host          Also run C7: open the caller under the partner's host name and report whether the key cookie reached the partner.",
    "  --no-bridge          Also run C8 for the first direction: serve the partner without its bridge and report the 10-second wait and the popup offer.",
    "  --guesthouse <dir>   The guesthouse to serve. Default: examples/guesthouse_agentified.",
    "  --tours <dir>        The tour site to serve. Default: examples/harbor_tours_agentified, else tests/linking/fixtures/partner_site.",
    "  --out <dir>          Where the report and logs go. Default: a new temp folder. Never inside the repository.",
  ].join("\n");

  /**
   * Keep the options and set up empty state.
   *
   * :param options: The parsed options.
   */
  constructor(options) {
    this.options = options;
    this.out = null;
    this.profile = null;
    this.router = null;
    this.chrome = null;
    this.client = null;
    // Role -> server child process.
    this.servers = new Map();
    // Role -> what its server printed on stdout.
    this.output = new Map();
    // Role -> the folder served for it.
    this.served = {};
    this.results = [];
    this.lines = [];
    this.stopping = null;
  }

  /**
   * Parse the command line.
   *
   * :param argv: The arguments after the script name.
   * :return: The options.
   * :raises Error: On an unknown option, a missing value or an unknown direction.
   */
  static parseArgs(argv) {
    const options = {
      chrome: null,
      direction: "both",
      sameHost: false,
      noBridge: false,
      guesthouse: null,
      tours: null,
      out: null,
      help: false,
    };
    const valued = {
      "--chrome": "chrome",
      "--direction": "direction",
      "--guesthouse": "guesthouse",
      "--tours": "tours",
      "--out": "out",
    };
    let index = 0;
    while (index < argv.length) {
      const arg = argv[index];
      if (arg === "--help" || arg === "-h") {
        options.help = true;
      } else if (arg === "--same-host") {
        options.sameHost = true;
      } else if (arg === "--no-bridge") {
        options.noBridge = true;
      } else if (Object.hasOwn(valued, arg)) {
        if (argv[index + 1] === undefined) {
          throw new Error(`${arg} needs a value.`);
        }
        options[valued[arg]] = argv[index + 1];
        index += 1;
      } else {
        throw new Error(`Unknown option: ${arg}`);
      }
      index += 1;
    }
    if (options.direction !== "both" && !Object.hasOwn(LinkingCheck.DIRECTIONS, options.direction)) {
      throw new Error(`Unknown direction: ${options.direction}`);
    }
    return options;
  }

  /**
   * Run the check and stop everything it started.
   *
   * :param argv: The arguments after the script name.
   * :return: The exit code.
   */
  static async main(argv) {
    let options = null;
    try {
      options = LinkingCheck.parseArgs(argv);
    } catch (error) {
      console.error(error.message);
      console.error(LinkingCheck.USAGE);
      return 2;
    }
    if (options.help) {
      console.log(LinkingCheck.USAGE);
      return 0;
    }
    const check = new LinkingCheck(options);
    process.once("SIGINT", check.interrupt.bind(check, "SIGINT"));
    process.once("SIGTERM", check.interrupt.bind(check, "SIGTERM"));
    process.once("exit", check.killNow.bind(check));
    const limit = setTimeout(check.overrun.bind(check), LinkingCheck.RUN_TIMEOUT_MS);
    limit.unref();
    try {
      return await check.run();
    } finally {
      clearTimeout(limit);
    }
  }

  /**
   * Print a line and keep it for the summary file.
   *
   * :param text: The line.
   */
  say(text) {
    console.log(text);
    this.lines.push(text);
  }

  /**
   * Choose the sites, check that the check can start, run the cases and report.
   *
   * :return: The exit code.
   */
  async run() {
    const sites = this.resolveSites();
    const directions = [];
    for (const name of this.directionNames()) {
      const skip = this.skipReason(name, sites);
      const problem = skip === null ? await this.linkProblem(name, sites) : null;
      directions.push({
        name: name,
        spec: LinkingCheck.DIRECTIONS[name],
        skip: skip,
        problem: problem,
      });
    }
    const toRun = [];
    const roles = [];
    for (const direction of directions) {
      if (direction.skip !== null || direction.problem !== null) {
        continue;
      }
      toRun.push(direction);
      for (const role of [direction.spec.caller, direction.spec.partner]) {
        if (!roles.includes(role)) {
          roles.push(role);
        }
      }
    }
    if (!toRun.length) {
      let unlinked = false;
      for (const direction of directions) {
        if (direction.problem !== null) {
          unlinked = true;
          console.error(`FAIL ${direction.name}: ${direction.problem}`);
        } else {
          console.error(`SKIP ${direction.name}: ${direction.skip}`);
        }
      }
      console.error("Nothing to run: no direction has two linked sites.");
      // A site that is not linked fails. Only a missing tour site means nothing can start.
      return unlinked ? 1 : 2;
    }
    const chrome = ChromeLauncher.locate(this.options.chrome);
    if (chrome === null) {
      console.error("Chrome was not found. Pass --chrome <path> or set CHROME.");
      return 2;
    }
    const busy = await this.busyPorts(roles);
    if (busy.length) {
      console.error(`These ports are in use: ${busy.join(", ")}. Stop what uses them, then run the check again.`);
      return 2;
    }
    try {
      this.out = await this.makeOut();
    } catch (error) {
      console.error(error.message);
      return 2;
    }
    this.say(`Output: ${this.out}`);
    for (const role of ["guesthouse", "tours", "caller"]) {
      this.say(`Site ${role}: ${sites[role].folder}${sites[role].real ? "" : " (test site)"}`);
    }
    for (const direction of directions) {
      if (direction.skip !== null) {
        await this.record("C1-C4", direction.name, "skipped", [], [direction.skip]);
      } else if (direction.problem !== null) {
        const checks = [];
        LinkingCheck.expect(checks, false, `the sites are linked: ${direction.problem}`);
        await this.record("C1-C4", direction.name, "failed", checks, []);
      }
    }
    let setupError = null;
    try {
      await this.start(roles, sites, chrome);
      await this.runCases(toRun, roles);
    } catch (error) {
      setupError = String(error.stack || error);
      this.say(`ERROR: ${error.message}`);
    } finally {
      await this.stopAll();
    }
    return this.finishReport(setupError);
  }

  /**
   * Find the folder to serve for each site.
   *
   * :return: For each role, its folder and whether it is a real site rather than a test site.
   */
  resolveSites() {
    const realTours = path.join(LinkingCheck.REPO, "examples", "harbor_tours_agentified");
    let tours = {
      folder: path.join(LinkingCheck.REPO, "tests", "linking", "fixtures", "partner_site"),
      real: false,
    };
    if (this.options.tours !== null) {
      tours = {
        folder: path.resolve(this.options.tours),
        real: true,
      };
    } else if (existsSync(realTours)) {
      tours = {
        folder: realTours,
        real: true,
      };
    }
    return {
      guesthouse: {
        folder: path.resolve(this.options.guesthouse || path.join(LinkingCheck.REPO, "examples", "guesthouse_agentified")),
        real: true,
      },
      tours: tours,
      caller: {
        folder: path.join(LinkingCheck.REPO, "tests", "linking", "fixtures", "caller_site"),
        real: false,
      },
    };
  }

  /**
   * The directions to run.
   *
   * :return: Their names.
   */
  directionNames() {
    if (this.options.direction === "both") {
      return Object.keys(LinkingCheck.DIRECTIONS);
    }
    return [this.options.direction];
  }

  /**
   * Read a site's manifest and published network.
   *
   * :param folder: The site folder.
   * :return: The manifest, the network file name and name, the link labels and the
   *   front agent's model.
   */
  static async readSite(folder) {
    const manifest = JSON.parse(await readFile(path.join(folder, "agent-manifest.json"), "utf8"));
    const entry = manifest.networks[0];
    const file = entry.hocon.replace(/^\.\//, "");
    const config = JSON.parse(await readFile(path.join(folder, file), "utf8"));
    const network = new AgentNetwork(config, entry.name);
    const front = network.getAgentSpec(network.findFrontMan());
    return {
      manifest: manifest,
      file: file,
      name: entry.name,
      config: network.config,
      labels: network.linkLabels || {},
      frontModel: String(((front || {}).llm_config || {}).model_name || ""),
    };
  }

  /**
   * Say why a direction must skip. Only the real tour site can call the guesthouse.
   *
   * :param name: The direction's name.
   * :param sites: The sites from resolveSites().
   * :return: The reason, or null when the direction can run.
   */
  skipReason(name, sites) {
    // The test partner site stands in for the tour site as a partner, never as a caller.
    if (LinkingCheck.DIRECTIONS[name].caller === "tours" && !sites.tours.real) {
      return "examples/harbor_tours_agentified does not exist yet, so the tour site cannot call the guesthouse.";
    }
    return null;
  }

  /**
   * Say why the sites of a direction are not linked, which fails the direction.
   *
   * :param name: The direction's name.
   * :param sites: The sites from resolveSites().
   * :return: The problem, or null when both sites are linked.
   */
  async linkProblem(name, sites) {
    const spec = LinkingCheck.DIRECTIONS[name];
    for (const role of [spec.caller, spec.partner]) {
      if (!existsSync(path.join(sites[role].folder, "agent-manifest.json"))) {
        return `${sites[role].folder} has no agent-manifest.json.`;
      }
    }
    const partner = await LinkingCheck.readSite(sites[spec.partner].folder);
    if (partner.manifest.actions && !partner.manifest.actions.bridge) {
      return `${sites[spec.partner].folder} has no actions.bridge, so other sites cannot call it.`;
    }
    const caller = await LinkingCheck.readSite(sites[spec.caller].folder);
    for (const agent of caller.config.tools || []) {
      if (Array.isArray(agent.tools) && agent.tools.includes(spec.partnerUrl)) {
        return null;
      }
    }
    return `${sites[spec.caller].folder} does not call ${spec.partnerUrl}.`;
  }

  /**
   * List the ports this run needs that something else uses.
   *
   * :param roles: The sites to serve.
   * :return: The busy ports, each with what needs it.
   */
  async busyPorts(roles) {
    const needed = [
      {
        port: LinkingCheck.ROUTER_PORT,
        what: "the mock router",
      },
      {
        port: LinkingCheck.DEVTOOLS_PORT,
        what: "Chrome DevTools",
      },
    ];
    for (const role of roles) {
      needed.push({
        port: LinkingCheck.SITES[role].port,
        what: `the ${LinkingCheck.SITES[role].title}`,
      });
    }
    const busy = [];
    for (const item of needed) {
      // "localhost" may reach ::1 first, so a server there would answer instead of ours.
      for (const host of ["127.0.0.1", "::1"]) {
        if (await LinkingCheck.portInUse(item.port, host)) {
          busy.push(`${item.port} on ${host} (for ${item.what})`);
        }
      }
    }
    return busy;
  }

  /**
   * Say whether a port is taken on one address.
   *
   * :param port: The port.
   * :param host: The address.
   * :return: True when something listens there.
   */
  static async portInUse(port, host) {
    const server = net.createServer();
    server.listen(port, host);
    try {
      await once(server, "listening");
    } catch (error) {
      // An address this machine does not have, such as ::1 without IPv6, is not in use.
      return error.code === "EADDRINUSE";
    }
    const closed = once(server, "close");
    server.close();
    await closed;
    return false;
  }

  /**
   * Make the output folder, outside the repository.
   *
   * :return: The folder's path.
   * :raises Error: When --out points inside the repository.
   */
  async makeOut() {
    let out = null;
    if (this.options.out !== null) {
      out = path.resolve(this.options.out);
      if (out === path.resolve(LinkingCheck.REPO) || out.startsWith(LinkingCheck.REPO)) {
        throw new Error("Give --out a folder outside the repository.");
      }
      await mkdir(out, {recursive: true});
    } else {
      out = await mkdtemp(path.join(os.tmpdir(), "linking-check-"));
    }
    for (const folder of ["logs", "cases", "sites"]) {
      await mkdir(path.join(out, folder), {recursive: true});
    }
    return out;
  }

  /**
   * Start the router, one server per site and Chrome, and connect to Chrome.
   *
   * :param roles: The sites to serve.
   * :param sites: The sites from resolveSites().
   * :param chromePath: The Chrome binary.
   * :raises Error: When a process does not start.
   */
  async start(roles, sites, chromePath) {
    // Each answer waits a little, as a real provider does, so the page shows the turn running.
    this.router = new MockRouter(LinkingCheck.KEY, "", 1, 150);
    await this.router.listen(LinkingCheck.ROUTER_PORT);
    this.say(`Mock router: http://127.0.0.1:${LinkingCheck.ROUTER_PORT}/v1`);
    for (const role of roles) {
      this.served[role] = await this.servedFolder(role, sites[role]);
      await this.startServer(role, this.served[role]);
    }
    this.profile = path.join(this.out, "chrome-profile");
    await mkdir(this.profile, {recursive: true});
    this.chrome = new ChromeLauncher(chromePath, LinkingCheck.DEVTOOLS_PORT, this.profile, path.join(this.out, "logs", "chrome.log"));
    await this.chrome.start();
    this.client = await CdpClient.connect(LinkingCheck.DEVTOOLS_PORT);
    this.say(`Chrome: ${chromePath}`);
  }

  /**
   * Find or make the folder to serve for a site. A test site gets a copy of the skill's
   * runtime, in a copy of the site in the output folder.
   *
   * :param role: The site's role.
   * :param site: Its folder and whether it is real.
   * :return: The folder to serve.
   */
  async servedFolder(role, site) {
    if (site.real) {
      return site.folder;
    }
    const copy = path.join(this.out, "sites", path.basename(site.folder));
    await cp(site.folder, copy, {recursive: true});
    await rm(path.join(copy, "runtime"), {
      recursive: true,
      force: true,
    });
    await cp(path.join(LinkingCheck.REPO, "skills", "agentify-website", "runtime"), path.join(copy, "runtime"), {recursive: true});
    return copy;
  }

  /**
   * Start serve_site.mjs for one site and wait for its "Open" line.
   *
   * :param role: The site's role.
   * :param folder: The folder to serve.
   * :raises Error: When the server exits or does not print its URL in time.
   */
  async startServer(role, folder) {
    const site = LinkingCheck.SITES[role];
    const script = path.join(LinkingCheck.REPO, "skills", "agentify-website", "scripts", "serve_site.mjs");
    const child = spawn(process.execPath, [
      script,
      folder,
      "--host",
      "127.0.0.1",
      "--port",
      String(site.port),
      "--open-as",
      site.host,
      "--log",
      path.join(this.out, "logs", `${role}.jsonl`),
    ], {
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    });
    this.servers.set(role, child);
    child.stderr.pipe(createWriteStream(path.join(this.out, "logs", `${role}.err`), {flags: "a"}));
    // Keep reading stdout, so nothing is lost and the server never blocks on a full pipe.
    this.output.set(role, "");
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", this.keepOutput.bind(this, role));
    const deadline = Date.now() + 10000;
    while (!this.output.get(role).includes("\n")) {
      if (child.exitCode !== null || child.signalCode !== null) {
        // Let the server's last words reach the error file.
        await LinkingCheck.sleep(200);
        const errors = await readFile(path.join(this.out, "logs", `${role}.err`), "utf8").catch(LinkingCheck.emptyText);
        throw new Error(`The ${site.title} server stopped: ${errors.trim()}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`The ${site.title} server did not start in 10 seconds.`);
      }
      await LinkingCheck.sleep(50);
    }
    const expected = `Open http://${site.host}:${site.port}/`;
    const first = this.output.get(role).split("\n")[0].trim();
    if (first !== expected) {
      throw new Error(`The ${site.title} server printed "${first}", expected "${expected}".`);
    }
    this.say(`Serving the ${site.title} at http://${site.host}:${site.port}/ from ${folder}`);
  }

  /**
   * Keep a server's stdout.
   *
   * :param role: The site's role.
   * :param chunk: The text it wrote.
   */
  keepOutput(role, chunk) {
    this.output.set(role, this.output.get(role) + chunk);
  }

  /**
   * Stand in for a file that could not be read.
   *
   * :return: "".
   */
  static emptyText() {
    return "";
  }

  /**
   * Wait for a while.
   *
   * :param ms: Milliseconds.
   * :return: A promise that resolves after ms.
   */
  static sleep(ms) {
    return new Promise(LinkingCheck.delay.bind(null, ms));
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

  /**
   * Stop a child process and wait for it. It is killed if it does not stop in 5 seconds.
   *
   * :param child: The child process.
   */
  static async stopChild(child) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const exited = once(child, "exit");
    const timer = setTimeout(LinkingCheck.forceKill.bind(null, child), 5000);
    child.kill("SIGTERM");
    await exited;
    clearTimeout(timer);
  }

  /**
   * Kill a child process at once.
   *
   * :param child: The child process.
   */
  static forceKill(child) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }

  /**
   * Stop Chrome, the servers and the router, and delete Chrome's profile, which holds the
   * fake key in the browser's storage. Safe to call more than once.
   */
  async stopAll() {
    if (this.stopping === null) {
      this.stopping = this.stopEverything();
    }
    await this.stopping;
  }

  /**
   * Do the work of stopAll() once.
   */
  async stopEverything() {
    if (this.client !== null) {
      this.client.close();
      this.client = null;
    }
    if (this.chrome !== null) {
      await this.chrome.stop();
    }
    for (const child of this.servers.values()) {
      await LinkingCheck.stopChild(child);
    }
    if (this.router !== null) {
      await this.router.close();
    }
    if (this.profile !== null) {
      await rm(this.profile, {
        recursive: true,
        force: true,
      });
    }
  }

  /**
   * Kill every child at once, for when the process exits without stopAll().
   */
  killNow() {
    if (this.chrome !== null) {
      this.chrome.killNow();
    }
    for (const child of this.servers.values()) {
      LinkingCheck.forceKill(child);
    }
  }

  /**
   * Stop everything after Ctrl+C or a kill signal, then exit.
   *
   * :param signal: The signal's name.
   */
  async interrupt(signal) {
    console.error(`Stopping after ${signal}.`);
    await this.stopAll();
    process.exit(130);
  }

  /**
   * Stop everything when the check runs past its time limit, then exit.
   */
  async overrun() {
    console.error(`The check ran past ${LinkingCheck.RUN_TIMEOUT_MS / 1000} seconds. Stopping.`);
    await this.stopAll();
    process.exit(3);
  }

  /**
   * Run every case for the directions and sites.
   *
   * :param directions: The directions to run.
   * :param roles: The served sites.
   */
  async runCases(directions, roles) {
    for (const direction of directions) {
      const context = await this.directionContext(direction);
      await this.caseAllowed(context, direction.name === "tours-to-gh" ? "C4" : "C1", LinkingCheck.VISITOR_MODEL);
      await this.caseAllowed(context, "C2", "");
      await this.caseDecline(context);
      if (this.options.sameHost) {
        await this.caseSameHost(context);
      }
    }
    for (const role of roles) {
      await this.caseOwnPage(role);
      await this.caseBridgePage(role);
    }
    if (roles.includes("caller") && roles.includes("guesthouse")) {
      await this.caseMainUrl();
    }
    if (this.options.noBridge) {
      await this.caseNoBridge(await this.directionContext(directions[0]));
    }
  }

  /**
   * Gather what the checks of one direction expect.
   *
   * :param direction: The direction.
   * :return: The context: URLs, hosts, the label, each site's model and partner facts.
   */
  async directionContext(direction) {
    const spec = direction.spec;
    const caller = await LinkingCheck.readSite(this.served[spec.caller]);
    // A facts partner's manifest and files sit in facts/, next to its main manifest.
    const prefix = spec.facts ? "facts/" : "";
    const partner = await LinkingCheck.readSite(path.join(this.served[spec.partner], prefix));
    const callerSite = LinkingCheck.SITES[spec.caller];
    const partnerSite = LinkingCheck.SITES[spec.partner];
    return {
      name: direction.name,
      title: `${callerSite.title} -> ${partnerSite.title}`,
      spec: spec,
      callerRole: spec.caller,
      partnerRole: spec.partner,
      callerUrl: `http://${callerSite.host}:${callerSite.port}/`,
      callerHost: `${callerSite.host}:${callerSite.port}`,
      callerPort: callerSite.port,
      partnerOrigin: `http://${partnerSite.host}:${partnerSite.port}`,
      partnerHost: `${partnerSite.host}:${partnerSite.port}`,
      partnerHostname: partnerSite.host,
      label: caller.labels[spec.listedUrl || spec.partnerUrl] || "",
      callerModel: caller.frontModel,
      partnerModel: partner.frontModel,
      // Paths under the partner's site folder: "facts/..." for a facts network.
      partnerPrefix: prefix,
      partnerFile: `${prefix}${partner.file}`,
      partnerAgentTools: ((partner.manifest.actions || {}).agentTools || []).length,
    };
  }

  /**
   * Run one visitor turn on the calling site and gather the evidence, with the router's
   * records and both servers' log lines from the same time.
   *
   * :param context: The direction context.
   * :param model: The visitor's model, or "" for none.
   * :param decision: The answer on each consent card.
   * :param callerUrl: The page to open.
   * :return: The evidence.
   */
  async visitorTurn(context, model, decision, callerUrl) {
    this.router.use(context.spec.request, 1);
    const since = Date.now();
    const run = new LinkCallRun(this.client, LinkingCheck.KEY);
    let error = null;
    try {
      await run.open(callerUrl);
      await run.applySetup(`http://127.0.0.1:${LinkingCheck.ROUTER_PORT}/v1`, model);
      await run.turn(context.spec.message, decision, LinkingCheck.TURN_TIMEOUT_MS);
      await run.finish();
    } catch (caught) {
      error = String(caught.message || caught);
    } finally {
      await run.close();
    }
    const evidence = run.evidence();
    evidence.error = error;
    evidence.router = this.routerSince(since);
    evidence.partnerLog = await this.serverLog(context.partnerRole, since);
    evidence.callerLog = await this.serverLog(context.callerRole, since);
    return evidence;
  }

  /**
   * The router's records since a time.
   *
   * :param since: A wall-clock time in ms.
   * :return: The records.
   */
  routerSince(since) {
    const found = [];
    for (const record of this.router.records) {
      if (record.time >= since) {
        found.push(record);
      }
    }
    return found;
  }

  /**
   * A server's log lines since a time.
   *
   * :param role: The site's role.
   * :param since: A wall-clock time in ms.
   * :return: The parsed lines.
   */
  async serverLog(role, since) {
    let text = "";
    try {
      text = await readFile(path.join(this.out, "logs", `${role}.jsonl`), "utf8");
    } catch (error) {
      return [];
    }
    const lines = [];
    for (const line of text.split("\n")) {
      if (line.trim()) {
        const record = JSON.parse(line);
        if (record.time >= since) {
          lines.push(record);
        }
      }
    }
    return lines;
  }

  /**
   * Add one check to a list.
   *
   * :param checks: The list.
   * :param ok: Whether the check passed.
   * :param text: What was expected.
   */
  static expect(checks, ok, text) {
    checks.push({
      ok: !!ok,
      text: text,
    });
  }

  /**
   * Keep a case's result, print it, and save its evidence.
   *
   * :param id: The case id, such as "C1".
   * :param direction: The direction or site it ran for.
   * :param status: "passed", "failed", "skipped" or "info".
   * :param checks: The checks.
   * :param notes: Facts to print.
   * :param evidence: The evidence to save, or omitted.
   */
  async record(id, direction, status, checks, notes, evidence) {
    let file = null;
    if (evidence !== undefined) {
      file = path.join(this.out, "cases", `${id}-${direction}.json`);
      await writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    this.results.push({
      id: id,
      direction: direction,
      status: status,
      checks: checks,
      notes: notes,
      evidence: file,
    });
    const word = {
      passed: "PASS",
      failed: "FAIL",
      skipped: "SKIP",
      info: "INFO",
    }[status];
    this.say(`${word} ${id} ${direction}`);
    for (const check of checks) {
      if (!check.ok) {
        this.say(`  x ${check.text}`);
      }
    }
    for (const note of notes) {
      this.say(`  - ${note}`);
    }
  }

  /**
   * The status for a list of checks.
   *
   * :param checks: The checks.
   * :return: "passed" when all passed, else "failed".
   */
  static status(checks) {
    for (const check of checks) {
      if (!check.ok) {
        return "failed";
      }
    }
    return "passed";
  }

  /**
   * Find the partner call's end in the trace.
   *
   * :param evidence: The evidence.
   * :return: The end event, or null.
   */
  static callEnd(evidence) {
    for (const event of evidence.trace.remoteCall) {
      if (event.phase === "end") {
        return event;
      }
    }
    return null;
  }

  /**
   * The router's chat records, from one side or both.
   *
   * :param evidence: The evidence.
   * :param role: "caller", "partner", or null for both.
   * :return: The records.
   */
  static chats(evidence, role) {
    const found = [];
    for (const record of evidence.router) {
      if (record.kind === "chat" && (role === null || record.role === role)) {
        found.push(record);
      }
    }
    return found;
  }

  /**
   * The website_* tools offered in some chat requests.
   *
   * :param chats: Chat records.
   * :return: The tool names, once each.
   */
  static websiteTools(chats) {
    const names = [];
    for (const chat of chats) {
      for (const name of chat.tools || []) {
        if (name.startsWith("website_") && !names.includes(name)) {
          names.push(name);
        }
      }
    }
    return names;
  }

  /**
   * The requests to one host.
   *
   * :param evidence: The evidence.
   * :param host: The host, with its port.
   * :return: The request records.
   */
  static requestsTo(evidence, host) {
    const found = [];
    for (const request of evidence.requests) {
      if (request.host === host) {
        found.push(request);
      }
    }
    return found;
  }

  /**
   * C1, C2 and C4: an allowed call, with or without a visitor model.
   *
   * :param context: The direction context.
   * :param id: "C1", "C2" or "C4".
   * :param model: The visitor's model, or "" for none.
   */
  async caseAllowed(context, id, model) {
    // With no visitor model and one model on both sites, the case could not show which
    // site chose the partner's model, so serve the partner naming another one.
    let swapped = null;
    if (!model && context.partnerModel === context.callerModel) {
      swapped = await this.servePartnerOnOtherModel(context);
    }
    let evidence = null;
    try {
      evidence = await this.visitorTurn(context, model, "allow", context.callerUrl);
    } finally {
      if (swapped !== null) {
        await this.servePartnerAgain(context);
      }
    }
    const expectedModel = model || context.callerModel;
    const checks = this.allowedChecks(context, evidence, expectedModel);
    const end = LinkingCheck.callEnd(evidence);
    const notes = [
      `${model ? "visitor model" : "no visitor model"}; every model call expected on ${expectedModel}`,
      `consent to the partner's answer: ${end && evidence.timing.consentAnsweredAt ? `${end.wall - evidence.timing.consentAnsweredAt} ms` : "none"}`,
      `the partner served ${evidence.partnerLog.length} requests; the caller's own page had ${LinkingCheck.websiteTools(LinkingCheck.chats(evidence, "caller")).length} website_* tools; the partner's manifest lists ${context.partnerAgentTools}`,
    ];
    if (swapped !== null) {
      notes.push(`both sites name ${context.callerModel}, so the partner was served naming ${swapped}, to show which site chose the partner's model`);
    }
    // A note, not a check: the runtime shows the partner bridge's "No actions exposed"
    // here (runtime/index.js), which is on the upstream list.
    notes.push(`the calling page's action note after the call: "${evidence.actionStatusDetail}"`);
    await this.record(id, context.name, LinkingCheck.status(checks), checks, notes, evidence);
  }

  /**
   * The checks of an allowed call.
   *
   * :param context: The direction context.
   * :param evidence: The evidence.
   * :param expectedModel: The model every chat request should use.
   * :return: The checks.
   */
  allowedChecks(context, evidence, expectedModel) {
    const checks = [];
    const expect = LinkingCheck.expect;
    expect(checks, evidence.error === null, `the driver ran without error (${evidence.error})`);
    expect(checks, evidence.outcome === "ended", `the turn ended (${evidence.outcome})`);
    const end = LinkingCheck.callEnd(evidence);
    expect(checks, end !== null && end.status === "ok", "the partner ran");
    const ms = end !== null && evidence.timing.consentAnsweredAt !== null ? end.wall - evidence.timing.consentAnsweredAt : null;
    expect(checks, ms !== null && ms < 5000, `the partner answered under 5 s after consent (${ms} ms)`);
    expect(checks, evidence.cards === 1, `exactly one consent card (${evidence.cards})`);
    const card = evidence.cardTexts[0] || "";
    expect(checks, context.label !== "" && card.includes(context.label), `the card shows the label "${context.label}"`);
    expect(checks, card.includes(context.partnerHost), `the card shows ${context.partnerHost}`);
    expect(checks, context.spec.request.length < 140 && card.includes(context.spec.request), "the card shows the whole request");
    const publicFiles = [
      `/${context.partnerPrefix}agent-manifest.json`,
      `/${context.partnerFile}`,
      `/${context.partnerPrefix}links.json`,
    ];
    const served = [];
    const other = [];
    if (context.spec.facts) {
      // A facts manifest has no actions, so no bridge frame loads, and the partner serves
      // its three facts files and nothing else.
      expect(checks, evidence.frames.length === 0 && evidence.polledFrames.length === 0, "no bridge frame");
      for (const line of evidence.partnerLog) {
        served.push(line.path);
        if (!publicFiles.includes(line.path)) {
          other.push(line.path);
        }
      }
      expect(checks, other.length === 0, `the partner served only its three facts files (also: ${other.join(", ")})`);
    } else {
      const bridge = `${context.partnerOrigin}/bridge/action-bridge.html`;
      let framed = false;
      for (const frame of evidence.frames) {
        if (frame.src === bridge && frame.sandbox === "allow-scripts allow-same-origin") {
          framed = true;
        }
      }
      expect(checks, framed, `the frame loaded ${bridge} with sandbox "allow-scripts allow-same-origin"`);
      for (const line of evidence.partnerLog) {
        served.push(line.path);
        if (!publicFiles.includes(line.path) && !line.path.startsWith("/bridge/") && !line.path.startsWith("/runtime/")) {
          other.push(line.path);
        }
      }
      expect(checks, other.length === 0, `the partner served only its public files, bridge/ and runtime/ (also: ${other.join(", ")})`);
      publicFiles.push("/bridge/action-bridge.html", "/bridge/agent-manifest.json");
    }
    for (const file of publicFiles) {
      expect(checks, served.includes(file), `the partner served ${file}`);
    }
    let popup = false;
    for (const dialog of evidence.dialogs) {
      if (dialog.text.includes("Continue at")) {
        popup = true;
      }
    }
    expect(checks, !popup, "no \"Continue at\" dialog");
    const routerHost = `127.0.0.1:${LinkingCheck.ROUTER_PORT}`;
    const keyElsewhere = [];
    const chatsElsewhere = [];
    for (const request of evidence.requests) {
      // The caller's own host gets the key in the runtime's loopback cookie (runtime/byok.js).
      const allowedHost = request.host === routerHost || (request.host === context.callerHost && !request.keyIn.includes("authorization"));
      if (request.keyIn.length && !allowedHost) {
        keyElsewhere.push(`${request.method} ${request.url} [${request.keyIn.join(", ")}]`);
      }
      if (request.path.endsWith("/chat/completions") && request.host !== routerHost) {
        chatsElsewhere.push(request.url);
      }
    }
    expect(checks, keyElsewhere.length === 0, `only router requests carry the key (also: ${keyElsewhere.join("; ")})`);
    const partnerKey = [];
    for (const request of LinkingCheck.requestsTo(evidence, context.partnerHost)) {
      if (request.authorization || request.cookies.includes(LinkingCheck.COOKIE) || request.keyIn.length) {
        partnerKey.push(request.path);
      }
    }
    for (const line of evidence.partnerLog) {
      if (line.authorization || line.cookies.includes(LinkingCheck.COOKIE)) {
        partnerKey.push(line.path);
      }
    }
    expect(checks, partnerKey.length === 0, `no request to ${context.partnerHost} has Authorization or the ${LinkingCheck.COOKIE} cookie (${partnerKey.join(", ")})`);
    expect(checks, chatsElsewhere.length === 0, `every chat request went to the mock router (also: ${chatsElsewhere.join(", ")})`);
    const chats = LinkingCheck.chats(evidence, null);
    const models = [];
    let keyMissing = 0;
    for (const chat of chats) {
      if (!models.includes(chat.model)) {
        models.push(chat.model);
      }
      if (!chat.keyOk) {
        keyMissing += 1;
      }
    }
    expect(checks, chats.length >= 3 && models.length === 1 && models[0] === expectedModel, `every chat request used ${expectedModel} (${chats.length} requests: ${models.join(", ")})`);
    expect(checks, keyMissing === 0, "every chat request carried the visitor's key");
    const partnerChats = LinkingCheck.chats(evidence, "partner");
    expect(checks, partnerChats.length >= 1, "the partner made a model call");
    const partnerTools = LinkingCheck.websiteTools(partnerChats);
    expect(checks, partnerTools.length === 0, `the partner was offered no website_* tool (${partnerTools.join(", ")})`);
    const answer = evidence.finalAnswer || "";
    if (context.spec.facts) {
      expect(checks, partnerChats.length === 1, `the facts network made one model call (${partnerChats.length})`);
      expect(checks, /^CALLER_FINAL: PARTNER_ANSWER: peer rule no; no-actions note no\. Facts as of \d{4}-\d{2}-\d{2}\./.test(answer), `the partner's dated facts answer, with no peer rule or no-actions note, reached the caller ("${answer.slice(0, 160)}")`);
      return checks;
    }
    expect(checks, answer.startsWith("CALLER_FINAL: PARTNER_ANSWER: peer rule yes; no-actions note yes."), `the partner's answer, with the peer rule and the no-actions note, reached the caller ("${answer.slice(0, 160)}")`);
    return checks;
  }

  /**
   * C9: the test caller, served naming the guesthouse's main network, calls it once. The
   * main network loads its bridge and runs with the peer rule, as callers that still name
   * a main URL get it.
   */
  async caseMainUrl() {
    const spec = LinkingCheck.MAIN_URL_CASE;
    const copy = path.join(this.out, "sites", "caller_main_url");
    await cp(this.served.caller, copy, {recursive: true});
    const caller = await LinkingCheck.readSite(copy);
    const file = path.join(copy, caller.file);
    const config = JSON.parse(await readFile(file, "utf8"));
    for (const agent of config.tools || []) {
      if (Array.isArray(agent.tools) && agent.tools.includes(spec.listedUrl)) {
        agent.tools = [spec.partnerUrl];
      }
    }
    const labels = Object.assign({}, config.link_labels || {});
    labels[spec.partnerUrl] = labels[spec.listedUrl];
    delete labels[spec.listedUrl];
    config.link_labels = labels;
    await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
    await LinkingCheck.stopChild(this.servers.get("caller"));
    await this.startServer("caller", copy);
    try {
      const context = await this.directionContext({
        name: "caller-to-gh-main",
        spec: spec,
      });
      const evidence = await this.visitorTurn(context, LinkingCheck.VISITOR_MODEL, "allow", context.callerUrl);
      const checks = this.allowedChecks(context, evidence, LinkingCheck.VISITOR_MODEL);
      await this.record("C9", context.name, LinkingCheck.status(checks), checks, ["the test caller, served naming the guesthouse's main network URL"], evidence);
    } finally {
      await LinkingCheck.stopChild(this.servers.get("caller"));
      await this.startServer("caller", this.served.caller);
    }
  }

  /**
   * C3: the visitor declines, and nothing at all goes to the partner.
   *
   * :param context: The direction context.
   */
  async caseDecline(context) {
    const evidence = await this.visitorTurn(context, LinkingCheck.VISITOR_MODEL, "decline", context.callerUrl);
    const checks = [];
    const expect = LinkingCheck.expect;
    expect(checks, evidence.error === null, `the driver ran without error (${evidence.error})`);
    expect(checks, evidence.outcome === "ended", `the turn ended (${evidence.outcome})`);
    expect(checks, evidence.cards === 1, `exactly one consent card (${evidence.cards})`);
    const toPartner = LinkingCheck.requestsTo(evidence, context.partnerHost);
    expect(checks, toPartner.length === 0 && evidence.partnerLog.length === 0, `no request at all to ${context.partnerHost} (browser ${toPartner.length}, server ${evidence.partnerLog.length})`);
    expect(checks, evidence.frames.length === 0 && evidence.polledFrames.length === 0, "no bridge frame");
    expect(checks, LinkingCheck.chats(evidence, "partner").length === 0, "the partner made no model call");
    const answer = evidence.finalAnswer || "";
    expect(checks, answer.startsWith(`CALLER_FINAL: The user declined to contact ${context.partnerHost}.`), `the caller said the visitor declined ("${answer.slice(0, 160)}")`);
    await this.record("C3", context.name, LinkingCheck.status(checks), checks, [], evidence);
  }

  /**
   * C7: the caller opened under the partner's host name. Reports whether the runtime's
   * key cookie reached the partner's host. It never fails the run.
   *
   * :param context: The direction context.
   */
  async caseSameHost(context) {
    const url = `http://${context.partnerHostname}:${context.callerPort}/`;
    const evidence = await this.visitorTurn(context, LinkingCheck.VISITOR_MODEL, "allow", url);
    let browserCookie = 0;
    let browserKey = 0;
    for (const request of LinkingCheck.requestsTo(evidence, context.partnerHost)) {
      if (request.cookies.includes(LinkingCheck.COOKIE)) {
        browserCookie += 1;
      }
      if (request.keyIn.includes("cookie")) {
        browserKey += 1;
      }
    }
    let serverCookie = 0;
    for (const line of evidence.partnerLog) {
      if (line.cookies.includes(LinkingCheck.COOKIE)) {
        serverCookie += 1;
      }
    }
    const end = LinkingCheck.callEnd(evidence);
    const notes = [
      `caller opened at ${url}; the partner ${end !== null && end.status === "ok" ? "ran" : "did not run"}`,
      `the ${LinkingCheck.COOKIE} cookie reached ${context.partnerHost}: ${serverCookie > 0 || browserCookie > 0 ? "yes" : "no"} (server log ${serverCookie} of ${evidence.partnerLog.length} requests, browser ${browserCookie}; with the key in it: ${browserKey})`,
    ];
    await this.record("C7", context.name, "info", [], notes, evidence);
  }

  /**
   * C5: a site's own page, with no key. The keyless read check succeeds, and the status
   * line counts the site's actions.
   *
   * :param role: The site's role.
   */
  async caseOwnPage(role) {
    const site = LinkingCheck.SITES[role];
    const url = `http://${site.host}:${site.port}/`;
    const manifest = JSON.parse(await readFile(path.join(this.served[role], "agent-manifest.json"), "utf8"));
    const agentTools = (manifest.actions || {}).agentTools || [];
    const run = new LinkCallRun(this.client, LinkingCheck.KEY);
    let result = null;
    let error = null;
    try {
      await run.open(url);
      await run.waitFor(PageScripts.ready(), 20000, "the runtime to boot");
      result = JSON.parse(await run.evaluate(PageScripts.readCheck(agentTools)));
    } catch (caught) {
      error = String(caught.message || caught);
    } finally {
      await run.close();
    }
    const checks = [];
    const expect = LinkingCheck.expect;
    expect(checks, error === null, `the page booted and ran the check (${error})`);
    const registered = result === null ? [] : result.registered;
    const missing = [];
    for (const name of agentTools) {
      if (!registered.includes(name)) {
        missing.push(name);
      }
    }
    expect(checks, result !== null && result.status === "succeeded", `the keyless read check returned succeeded (${result === null ? "no result" : `${result.action}: ${result.status}`})`);
    expect(checks, registered.length >= 1 && result.summary === `${registered.length} website actions connected`, `the status shows "${registered.length} website actions connected" ("${result === null ? "" : result.summary}")`);
    expect(checks, missing.length === 0, `every agentTools action is registered (missing: ${missing.join(", ")})`);
    const evidence = run.evidence();
    evidence.readCheck = result;
    await this.record("C5", role, LinkingCheck.status(checks), checks, [], evidence);
  }

  /**
   * C6: a site's bridge page opened directly says to open it through an agent action,
   * loads none of the site's own code, and logs no error.
   *
   * :param role: The site's role.
   */
  async caseBridgePage(role) {
    const site = LinkingCheck.SITES[role];
    const url = `http://${site.host}:${site.port}/bridge/action-bridge.html`;
    const since = Date.now();
    const run = new LinkCallRun(this.client, LinkingCheck.KEY);
    let body = null;
    let error = null;
    try {
      await run.open(url);
      body = await run.waitFor(PageScripts.bodyText(), 10000, "the bridge page's text");
      // Let late console lines arrive.
      await LinkingCheck.sleep(500);
    } catch (caught) {
      error = String(caught.message || caught);
    } finally {
      await run.close();
    }
    const evidence = run.evidence();
    evidence.body = body;
    evidence.serverLog = await this.serverLog(role, since);
    const checks = [];
    const expect = LinkingCheck.expect;
    expect(checks, error === null, `the page loaded (${error})`);
    expect(checks, body === "Open this page through an agent action.", `the body reads "Open this page through an agent action." ("${body}")`);
    const errors = [];
    for (const entry of evidence.console) {
      const isError = entry.type === "error" || entry.type === "exception" || entry.type === "assert" || entry.type === "log-error";
      // Chrome asks for /favicon.ico for every page it opens. The bridge page names no icon.
      const favicon = entry.type === "log-error" && String(entry.url || "").endsWith("/favicon.ico");
      if (isError && !favicon) {
        errors.push(entry.text);
      }
    }
    expect(checks, errors.length === 0, `the console has no errors (${errors.join("; ")})`);
    const siteCode = [];
    for (const line of evidence.serverLog) {
      if (!line.path.startsWith("/bridge/") && !line.path.startsWith("/runtime/") && line.path !== "/favicon.ico") {
        siteCode.push(line.path);
      }
    }
    expect(checks, siteCode.length === 0, `the bridge loaded none of the site's own files (${siteCode.join(", ")})`);
    await this.record("C6", role, LinkingCheck.status(checks), checks, [], evidence);
  }

  /**
   * Serve a copy of the partner whose network names another model than the calling site.
   *
   * :param context: The direction context.
   * :return: The model the copy names.
   * :raises Error: When the partner's server does not start.
   */
  async servePartnerOnOtherModel(context) {
    const other = context.callerModel === "gpt-4o-mini" ? "gpt-4.1-nano" : "gpt-4o-mini";
    const copy = path.join(this.out, "sites", `${context.partnerRole}_other_model`);
    await cp(this.served[context.partnerRole], copy, {recursive: true});
    const file = path.join(copy, context.partnerFile);
    const config = JSON.parse(await readFile(file, "utf8"));
    config.llm_config = {model_name: other};
    // An agent's own llm_config would win over the network's.
    for (const agent of config.tools || []) {
      delete agent.llm_config;
    }
    await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
    await LinkingCheck.stopChild(this.servers.get(context.partnerRole));
    await this.startServer(context.partnerRole, copy);
    return other;
  }

  /**
   * Serve the partner's own folder again, after a case that served a copy.
   *
   * :param context: The direction context.
   * :raises Error: When the partner's server does not start.
   */
  async servePartnerAgain(context) {
    await LinkingCheck.stopChild(this.servers.get(context.partnerRole));
    await this.startServer(context.partnerRole, this.served[context.partnerRole]);
  }

  /**
   * C8: the partner served without its bridge. Reports the 10-second wait and the popup
   * offer that follow. It never fails the run.
   *
   * :param context: The direction context.
   */
  async caseNoBridge(context) {
    const copy = path.join(this.out, "sites", `${context.partnerRole}_no_bridge`);
    await cp(this.served[context.partnerRole], copy, {recursive: true});
    await rm(path.join(copy, "bridge"), {
      recursive: true,
      force: true,
    });
    const manifest = JSON.parse(await readFile(path.join(copy, "agent-manifest.json"), "utf8"));
    if (manifest.actions) {
      delete manifest.actions.bridge;
    }
    await writeFile(path.join(copy, "agent-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await LinkingCheck.stopChild(this.servers.get(context.partnerRole));
    await this.startServer(context.partnerRole, copy);
    const evidence = await this.visitorTurn(context, LinkingCheck.VISITOR_MODEL, "allow", context.callerUrl);
    let popupAt = null;
    for (const dialog of evidence.dialogs) {
      if (popupAt === null && dialog.text.includes("Continue at")) {
        popupAt = dialog.at;
      }
    }
    const waited = popupAt !== null && evidence.timing.consentAnsweredAt !== null ? popupAt - evidence.timing.consentAnsweredAt : null;
    const notes = [
      `"Continue at" dialog: ${popupAt === null ? "no" : `yes, ${waited} ms after consent`}`,
      `the partner ${LinkingCheck.chats(evidence, "partner").length ? "ran" : "never ran"}; final answer: "${String(evidence.finalAnswer || "").slice(0, 160)}"`,
    ];
    await this.record("C8", context.name, "info", [], notes, evidence);
  }

  /**
   * Write the report and the summary, check the output for the key, and choose the exit code.
   *
   * :param setupError: The error that stopped the run, or null.
   * :return: The exit code.
   */
  async finishReport(setupError) {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let info = 0;
    for (const result of this.results) {
      if (result.status === "passed") {
        passed += 1;
      } else if (result.status === "failed") {
        failed += 1;
      } else if (result.status === "skipped") {
        skipped += 1;
      } else {
        info += 1;
      }
    }
    this.say(`${passed} passed, ${failed} failed, ${skipped} skipped, ${info} for information.`);
    const report = {
      options: this.options,
      served: this.served,
      setupError: setupError,
      results: this.results,
    };
    await writeFile(path.join(this.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(this.out, "logs", "router.jsonl"), LinkingCheck.jsonLines(this.router === null ? [] : this.router.records));
    const leaks = await LinkingCheck.filesWithKey(this.out);
    if (leaks.length) {
      this.say(`ERROR: the key appears in ${leaks.join(", ")}`);
    }
    this.say(`Report: ${path.join(this.out, "report.json")}`);
    await writeFile(path.join(this.out, "summary.txt"), `${this.lines.join("\n")}\n`);
    if (setupError !== null) {
      return 2;
    }
    return failed || leaks.length ? 1 : 0;
  }

  /**
   * Write records as JSON lines.
   *
   * :param records: The records.
   * :return: The text.
   */
  static jsonLines(records) {
    let text = "";
    for (const record of records) {
      text += `${JSON.stringify(record)}\n`;
    }
    return text;
  }

  /**
   * List the files under a folder that hold the key. The served site copies are skipped:
   * they are the sites' own files.
   *
   * :param folder: The output folder.
   * :return: The paths.
   */
  static async filesWithKey(folder) {
    const found = [];
    const entries = await readdir(folder, {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      const file = path.join(entry.parentPath, entry.name);
      if (!entry.isFile() || file.startsWith(path.join(folder, "sites"))) {
        continue;
      }
      const text = await readFile(file, "utf8");
      if (text.includes(LinkingCheck.KEY) || text.includes(encodeURIComponent(LinkingCheck.KEY))) {
        found.push(file);
      }
    }
    return found;
  }
}

process.exitCode = await LinkingCheck.main(process.argv.slice(2));

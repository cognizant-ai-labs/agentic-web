// Checks that skill-built sites link both ways in the real runtime: the card comes before
// any contact, the partner's public files and bridge load, the partner runs on the calling
// site's model, and the key goes only to the router.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The sites are served from disk under their local URLs by a stub fetch, the router is
// scripted and the key is fake, so nothing leaves the process. See tests/linking/README.md.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Engine } from "../../skills/agentify-website/runtime/engine.js";
import { parseHocon } from "../../skills/agentify-website/runtime/hocon.js";
import { AgentNetwork, parseExternalAgent } from "../../skills/agentify-website/runtime/kernel.js";
import { safeName } from "../../skills/agentify-website/runtime/runner.js";
import { MockRouter } from "./chrome/mock_router.mjs";
import { ExampleWeb } from "./example_web.mjs";

/**
 * Runs visitor turns in which one site's network calls another's, and checks what each
 * side sent and received.
 *
 * Each direction names the calling site, the partner and the scripted messages. A test
 * skips, with the reason, only while the real tour site does not exist. A site that is
 * not linked fails, so a change that unlinks it is caught. The calling site's own actions
 * are left out of its served manifest, because Node cannot import its action module over
 * HTTP. Its own tests cover them.
 */
class LinkingTest {
  /**
   * The repository root.
   */
  static REPO = fileURLToPath(new URL("../../", import.meta.url));

  /**
   * The fake key. Only the stub fetch sees it.
   */
  static KEY = "sk-test-not-a-real-key";

  /**
   * The router the visitor's settings name.
   */
  static ROUTER = "http://127.0.0.1:8791/v1";

  /**
   * A model the visitor picks, which no site names.
   */
  static VISITOR_MODEL = "gpt-5.2";

  /**
   * Where each site is served, as in the plan's address table.
   */
  static ORIGINS = {
    guesthouse: "http://127.0.0.1:8080",
    tours: "http://localhost:8081",
    caller: "http://localhost:8082",
  };

  /**
   * Each direction: who calls whom, the partner's network URL, the visitor's message and
   * the request the calling site sends. Each request is under 140 characters.
   */
  static DIRECTIONS = {
    "caller-to-gh": {
      caller: "caller",
      partner: "guesthouse",
      partnerUrl: "http://127.0.0.1:8080/tidewhistle_guesthouse",
      message: "Can you ask Tidewhistle Guesthouse whether a step-free room is free for two from 12 to 14 June?",
      request: "Is a step-free room free for two adults from 12 to 14 June, and what would it cost?",
    },
    "gh-to-tours": {
      caller: "guesthouse",
      partner: "tours",
      partnerUrl: "http://localhost:8081/marrow_point_harbor_tours",
      message: "Are there boat trips from the harbor while we stay, from 12 to 14 June?",
      request: "Is there a boat trip for two adults between 12 and 14 June, and what does it cost?",
    },
    "tours-to-gh": {
      caller: "tours",
      partner: "guesthouse",
      partnerUrl: "http://127.0.0.1:8080/tidewhistle_guesthouse",
      message: "Where can we stay in Marrow Point from 12 to 14 June?",
      request: "Is a room free for two adults from 12 to 14 June, and what would it cost?",
    },
  };

  /**
   * The second hop: the test caller asks the tour site, and the tour site's network asks
   * the guesthouse. Each request is under 140 characters.
   */
  static SECOND_HOP = {
    message: "What boat trips can we take from Marrow Point, and is there somewhere to stay nearby?",
    request: "What boat trips do you offer, and is there somewhere to stay nearby?",
    onward: "What rooms do you offer, and how do we book a stay?",
  };

  /**
   * Find the site folders. LINKING_GUESTHOUSE and LINKING_TOURS point the tests at other
   * copies, such as a fresh-agent round's output.
   *
   * :return: For each site, its folder, and for the tour site whether it is the real one.
   */
  static sites() {
    const realTours = path.join(LinkingTest.REPO, "examples", "harbor_tours_agentified");
    let tours = path.join(LinkingTest.REPO, "tests", "linking", "fixtures", "partner_site");
    let real = false;
    if (process.env.LINKING_TOURS) {
      tours = path.resolve(process.env.LINKING_TOURS);
      real = true;
    } else if (existsSync(realTours)) {
      tours = realTours;
      real = true;
    }
    return {
      guesthouse: path.resolve(process.env.LINKING_GUESTHOUSE || path.join(LinkingTest.REPO, "examples", "guesthouse_agentified")),
      tours: tours,
      caller: path.join(LinkingTest.REPO, "tests", "linking", "fixtures", "caller_site"),
      realTours: real,
    };
  }

  /**
   * Read a site's manifest and published network from disk.
   *
   * :param folder: The site folder.
   * :return: The manifest, the network config, its file name and its AgentNetwork.
   */
  static async readSite(folder) {
    const manifest = JSON.parse(await readFile(path.join(folder, "agent-manifest.json"), "utf8"));
    const entry = manifest.networks[0];
    const file = entry.hocon.replace(/^\.\//, "");
    const config = parseHocon(await readFile(path.join(folder, file), "utf8"));
    return {
      manifest: manifest,
      config: config,
      file: file,
      name: entry.name,
      network: new AgentNetwork(config, entry.name),
    };
  }

  /**
   * Say why a direction must skip, and fail when its sites exist but are not linked.
   *
   * :param direction: The direction's name.
   * :return: The reason to skip, or null when both sites are ready.
   * :raises AssertionError: When a site has no manifest, the partner has no
   *   actions.bridge, or the calling site does not call the partner.
   */
  static async skipReason(direction) {
    const spec = LinkingTest.DIRECTIONS[direction];
    const sites = LinkingTest.sites();
    // The test partner site stands in for the tour site as a partner, never as a caller.
    if (spec.caller === "tours" && !sites.realTours) {
      return "examples/harbor_tours_agentified does not exist yet, so the tour site cannot call the guesthouse.";
    }
    for (const role of [spec.caller, spec.partner]) {
      assert.ok(existsSync(path.join(sites[role], "agent-manifest.json")), `${sites[role]} has no agent-manifest.json.`);
    }
    const partner = await LinkingTest.readSite(sites[spec.partner]);
    assert.ok(!partner.manifest.actions || partner.manifest.actions.bridge, `${sites[spec.partner]} has no actions.bridge, so other sites cannot call it.`);
    const caller = await LinkingTest.readSite(sites[spec.caller]);
    assert.ok(LinkingTest.lists(caller.network.config, spec.partnerUrl), `${sites[spec.caller]} does not call ${spec.partnerUrl}.`);
    return null;
  }

  /**
   * Say whether any agent of a network lists a tool.
   *
   * :param config: The network config.
   * :param ref: The tool reference.
   * :return: True when an agent lists it.
   */
  static lists(config, ref) {
    for (const agent of config.tools || []) {
      if (Array.isArray(agent.tools) && agent.tools.includes(ref)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Serve the sites for one direction, with a router scripted for it.
   *
   * :param direction: The direction's name.
   * :param handoffs: How many partner calls the calling site makes before it answers.
   * :return: The setup: web, router, spec, both sites, the expected label, and each
   *   site's front-agent model.
   */
  static async setUp(direction, handoffs) {
    const spec = LinkingTest.DIRECTIONS[direction];
    const sites = LinkingTest.sites();
    const router = new MockRouter(LinkingTest.KEY, spec.request, handoffs, 0);
    const web = new ExampleWeb(router, new URL(LinkingTest.ROUTER).origin, LinkingTest.KEY);
    web.serve(LinkingTest.ORIGINS.guesthouse, sites.guesthouse);
    web.serve(LinkingTest.ORIGINS.tours, sites.tours);
    web.serve(LinkingTest.ORIGINS.caller, sites.caller);
    const caller = await LinkingTest.readSite(sites[spec.caller]);
    const partner = await LinkingTest.readSite(sites[spec.partner]);
    const callerOrigin = LinkingTest.ORIGINS[spec.caller];
    // Node cannot import the calling site's action module over HTTP.
    const served = structuredClone(caller.manifest);
    delete served.actions;
    web.replace(`${callerOrigin}/agent-manifest.json`, served);
    const front = caller.network.getAgentSpec(caller.network.findFrontMan());
    const partnerFront = partner.network.getAgentSpec(partner.network.findFrontMan());
    return {
      spec: spec,
      web: web,
      router: router,
      caller: caller,
      partner: partner,
      callerOrigin: callerOrigin,
      callerManifest: served,
      partnerOrigin: LinkingTest.ORIGINS[spec.partner],
      partnerHost: new URL(LinkingTest.ORIGINS[spec.partner]).host,
      label: (caller.network.linkLabels || {})[spec.partnerUrl] || "",
      tool: safeName(parseExternalAgent(spec.partnerUrl, callerOrigin).agentName),
      callerModel: String((front.llm_config || {}).model_name || ""),
      partnerModel: String((partnerFront.llm_config || {}).model_name || ""),
    };
  }

  /**
   * Serve the sites for the second hop. The test caller's served network names the tour
   * site in place of the guesthouse, and the tour site keeps its own call to the guesthouse.
   *
   * :param allowed: False to serve the tour site with an empty allowed_peers.
   * :return: The setup, with the fields run() and the second-hop test read.
   */
  static async setUpSecondHop(allowed) {
    const sites = LinkingTest.sites();
    const toursUrl = LinkingTest.DIRECTIONS["gh-to-tours"].partnerUrl;
    const router = new MockRouter(LinkingTest.KEY, LinkingTest.SECOND_HOP.request, 1, 0);
    router.nest(LinkingTest.SECOND_HOP.onward);
    const web = new ExampleWeb(router, new URL(LinkingTest.ROUTER).origin, LinkingTest.KEY);
    web.serve(LinkingTest.ORIGINS.guesthouse, sites.guesthouse);
    web.serve(LinkingTest.ORIGINS.tours, sites.tours);
    web.serve(LinkingTest.ORIGINS.caller, sites.caller);
    const caller = await LinkingTest.readSite(sites.caller);
    const tours = await LinkingTest.readSite(sites.tours);
    const callerOrigin = LinkingTest.ORIGINS.caller;
    // Node cannot import the calling site's action module over HTTP.
    const manifest = structuredClone(caller.manifest);
    delete manifest.actions;
    manifest.allowed_peers = [LinkingTest.ORIGINS.tours];
    web.replace(`${callerOrigin}/agent-manifest.json`, manifest);
    const config = structuredClone(caller.config);
    const frontName = caller.network.findFrontMan();
    let callerModel = "";
    for (const agent of config.tools) {
      if (agent.name === frontName) {
        agent.tools = [toursUrl];
        callerModel = String((caller.network.getAgentSpec(frontName).llm_config || {}).model_name || "");
      }
    }
    config.link_labels = {[toursUrl]: "Marrow Point Harbor Tours"};
    web.replace(`${callerOrigin}/${caller.file}`, config);
    if (!allowed) {
      const toursManifest = structuredClone(tours.manifest);
      toursManifest.allowed_peers = [];
      web.replace(`${LinkingTest.ORIGINS.tours}/agent-manifest.json`, toursManifest);
    }
    return {
      spec: {message: LinkingTest.SECOND_HOP.message},
      web: web,
      router: router,
      callerOrigin: callerOrigin,
      partnerOrigin: LinkingTest.ORIGINS.tours,
      label: "Marrow Point Harbor Tours",
      callerModel: callerModel,
    };
  }

  /**
   * Serve the partner's network naming a model the calling site does not name, so a test
   * can show that the partner ran on the calling site's model.
   *
   * :param setup: The setup from setUp().
   * :return: The model the served partner network names.
   */
  static servePartnerOnOtherModel(setup) {
    const other = setup.callerModel === "gpt-4o-mini" ? "gpt-4.1-nano" : "gpt-4o-mini";
    const config = structuredClone(setup.partner.config);
    config.llm_config = {model_name: other};
    // An agent's own llm_config would win over the network's.
    for (const agent of config.tools || []) {
      delete agent.llm_config;
    }
    setup.web.replace(`${setup.partnerOrigin}/${setup.partner.file}`, config);
    return other;
  }

  /**
   * Run one visitor turn on the calling site.
   *
   * :param setup: The setup from setUp().
   * :param visitorModel: The model the visitor picked, or "" for none.
   * :param decision: What the visitor answers on every card: "allow" or "decline".
   * :return: The run: the cards shown, the trace events and the turn's result.
   */
  static async run(setup, visitorModel, decision) {
    const run = {
      cards: [],
      trace: [],
      result: null,
    };
    setup.web.install();
    try {
      const engine = new Engine({
        originUrl: setup.callerOrigin,
        byokKey: LinkingTest.KEY,
        routerOverride: LinkingTest.ROUTER,
        modelOverride: visitorModel,
      });
      engine.onConsent = LinkingTest.answerCard.bind(null, setup, run, decision);
      run.trace = engine.trace.events;
      run.result = await engine.runTurn(setup.spec.message);
    } finally {
      setup.web.restore();
    }
    return run;
  }

  /**
   * Record a consent card and answer it.
   *
   * :param setup: The setup.
   * :param run: The run, which keeps the card.
   * :param decision: The answer.
   * :param info: What the card shows.
   * :return: The answer.
   */
  static async answerCard(setup, run, decision, info) {
    run.cards.push({
      kind: info.kind,
      peerLabel: info.peerLabel,
      peerOrigin: info.peerOrigin,
      requestText: info.requestText,
      // Requests made before the visitor answered.
      before: setup.web.requests.length,
    });
    return decision;
  }

  /**
   * List the paths of requests to one origin.
   *
   * :param records: Request records.
   * :param origin: The origin.
   * :return: The paths, in order.
   */
  static paths(records, origin) {
    const found = [];
    for (const record of records) {
      if (record.origin === origin) {
        found.push(record.path);
      }
    }
    return found;
  }

  /**
   * Find the trace events of one kind and phase.
   *
   * :param trace: The trace events.
   * :param kind: The event kind, such as "remote_call".
   * :param phase: "start", "end" or "note".
   * :return: The events, in order.
   */
  static events(trace, kind, phase) {
    const found = [];
    for (const event of trace) {
      if (event.kind === kind && event.phase === phase) {
        found.push(event);
      }
    }
    return found;
  }

  /**
   * The tool results the calling site's front agent saw last.
   *
   * :param router: The router.
   * :return: The results, in order.
   */
  static lastResults(router) {
    const chats = router.callerChats();
    return chats.length ? chats[chats.length - 1].toolResults : [];
  }

  /**
   * Check what every direction's allowed call has in common: one card before any contact,
   * the partner's public files and bridge, the key only on the router, and the answer.
   *
   * :param setup: The setup.
   * :param run: The run.
   */
  static checkAllowedCall(setup, run) {
    const web = setup.web;
    assert.equal(run.cards.length, 1, "Expected exactly one consent card.");
    const card = run.cards[0];
    assert.ok(setup.label, `The calling site has no link_labels entry for ${setup.spec.partnerUrl}.`);
    assert.equal(card.peerLabel, setup.label);
    // The calling site writes the label itself, so check that it names the partner's site.
    const brand = String(setup.partner.manifest.brand || "").toLowerCase();
    for (const word of setup.label.toLowerCase().split(/\s+/)) {
      assert.ok(brand.includes(word), `The card names "${setup.label}", but the partner's brand is "${setup.partner.manifest.brand}".`);
    }
    assert.equal(card.peerOrigin, setup.partnerHost);
    assert.equal(card.requestText, setup.spec.request);
    assert.deepEqual(LinkingTest.paths(web.requests.slice(0, card.before), setup.partnerOrigin), [], "The partner was contacted before the visitor answered the card.");
    // After Allow: the partner's manifest, network file and links.json, then its bridge.
    assert.deepEqual(LinkingTest.paths(web.requestsTo(setup.partnerOrigin, "runtime"), setup.partnerOrigin), [
      "/agent-manifest.json",
      `/${setup.partner.file}`,
      "/links.json",
    ]);
    assert.equal(web.frames.length, 1, "Expected one bridge frame.");
    assert.equal(web.frames[0].src, `${setup.partnerOrigin}/bridge/action-bridge.html`);
    assert.equal(web.frames[0].sandbox, "allow-scripts allow-same-origin");
    assert.equal(web.frames[0].ready, true, `The bridge never said it was ready: ${web.frames[0].error}`);
    assert.deepEqual(web.dialogs, []);
    // The key goes only to the router, and nothing goes to a host the test does not serve.
    for (const record of web.requests) {
      if (record.origin !== new URL(LinkingTest.ROUTER).origin) {
        assert.equal(record.keySent, false, `${record.url} got the key.`);
        assert.equal(record.authorization, false, `${record.url} got an Authorization header.`);
      }
    }
    assert.deepEqual(web.unexpected, []);
    // The partner runs on the visitor's router and key, with only the request.
    const partnerChats = setup.router.partnerChats();
    assert.ok(partnerChats.length >= 1, "The partner made no model call.");
    for (const chat of partnerChats) {
      assert.equal(chat.keyOk, true, "A partner model call did not carry the visitor's key.");
    }
    assert.deepEqual(partnerChats[0].roles, ["system", "user"]);
    assert.equal(partnerChats[0].peerRule, true, "The partner's instructions lack the peer rule.");
    assert.equal(partnerChats[0].noActionsNote, true, "The partner's prompt lacks the runtime's no-actions note.");
    const calls = LinkingTest.events(run.trace, "remote_call", "start");
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0].requestPayload.sly_data || {}), []);
    assert.match(run.result.text, /^CALLER_FINAL: PARTNER_ANSWER: peer rule yes; no-actions note yes\.$/);
  }

  /**
   * L1 and L4: with no visitor model, one card, then the partner's files and bridge, the
   * partner on the calling site's model, and the key only on the router.
   *
   * :param direction: The direction's name.
   * :param t: The test context.
   */
  static async testAllowedCall(direction, t) {
    const reason = await LinkingTest.skipReason(direction);
    if (reason !== null) {
      t.skip(reason);
      return;
    }
    const setup = await LinkingTest.setUp(direction, 1);
    assert.ok(setup.callerModel, "The calling site's front agent names no model.");
    if (setup.partnerModel === setup.callerModel) {
      const other = LinkingTest.servePartnerOnOtherModel(setup);
      t.diagnostic(`Both sites name ${setup.callerModel}, so the partner's network is served naming ${other}, to show which site chose the partner's model.`);
    }
    const run = await LinkingTest.run(setup, "", "allow");
    LinkingTest.checkAllowedCall(setup, run);
    for (const chat of setup.router.partnerChats()) {
      assert.equal(chat.model, setup.callerModel, "The partner did not use the calling site's model.");
    }
    for (const chat of setup.router.callerChats()) {
      assert.equal(chat.model, setup.callerModel);
    }
  }

  /**
   * L2: a model the visitor picked is used by both sites.
   *
   * :param direction: The direction's name.
   * :param t: The test context.
   */
  static async testVisitorModel(direction, t) {
    const reason = await LinkingTest.skipReason(direction);
    if (reason !== null) {
      t.skip(reason);
      return;
    }
    const setup = await LinkingTest.setUp(direction, 1);
    const run = await LinkingTest.run(setup, LinkingTest.VISITOR_MODEL, "allow");
    LinkingTest.checkAllowedCall(setup, run);
    for (const record of setup.router.records) {
      if (record.kind === "chat") {
        assert.equal(record.model, LinkingTest.VISITOR_MODEL, `A ${record.role} model call did not use the visitor's model.`);
      }
    }
  }

  /**
   * L3: when the visitor declines, nothing at all goes to the partner.
   *
   * :param direction: The direction's name.
   * :param t: The test context.
   */
  static async testDecline(direction, t) {
    const reason = await LinkingTest.skipReason(direction);
    if (reason !== null) {
      t.skip(reason);
      return;
    }
    const setup = await LinkingTest.setUp(direction, 1);
    const run = await LinkingTest.run(setup, "", "decline");
    assert.equal(run.cards.length, 1);
    assert.deepEqual(setup.web.requestsTo(setup.partnerOrigin, null), [], "A declined call contacted the partner.");
    assert.deepEqual(setup.web.frames, []);
    assert.deepEqual(setup.router.partnerChats(), []);
    assert.equal(run.result.text, `CALLER_FINAL: The user declined to contact ${setup.partnerHost}. Proceed without it and note that to the user.`);
  }

  /**
   * L5: a partner that would call back the calling site is not offered that tool, so the
   * visitor sees one card. When the partner's network does not call the calling site, the
   * test adds that call to the served copy.
   *
   * :param direction: The direction's name.
   * :param t: The test context.
   */
  static async testNoCallBack(direction, t) {
    const reason = await LinkingTest.skipReason(direction);
    if (reason !== null) {
      t.skip(reason);
      return;
    }
    const setup = await LinkingTest.setUp(direction, 1);
    const callerUrl = `${setup.callerOrigin}/${setup.caller.name}`;
    if (!LinkingTest.lists(setup.partner.config, callerUrl)) {
      const config = structuredClone(setup.partner.config);
      for (const agent of config.tools) {
        if (agent.name === setup.partner.network.findFrontMan()) {
          agent.tools = (agent.tools || []).concat([callerUrl]);
        }
      }
      setup.web.replace(`${setup.partnerOrigin}/${setup.partner.file}`, config);
      t.diagnostic(`The partner's network does not call ${callerUrl}, so the test adds that call.`);
    }
    const run = await LinkingTest.run(setup, "", "allow");
    assert.equal(run.cards.length, 1, "Expected exactly one consent card.");
    const partnerChats = setup.router.partnerChats();
    assert.ok(partnerChats.length >= 1, "The partner made no model call.");
    const callBack = safeName(parseExternalAgent(callerUrl, setup.partnerOrigin).agentName);
    assert.ok(!partnerChats[0].tools.includes(callBack), `The partner was offered ${callBack}, which calls back the calling site.`);
    const skips = LinkingTest.events(run.trace, "composition_skip", "note");
    assert.equal(skips.length, 1);
    assert.equal(skips[0].target, callerUrl);
    assert.equal(skips[0].reason, "already visited in this request");
    assert.match(run.result.text, /^CALLER_FINAL: PARTNER_ANSWER: /);
  }

  /**
   * L6: a second call to the same partner in one visitor message is skipped, and the
   * partner runs once.
   *
   * :param direction: The direction's name.
   * :param t: The test context.
   */
  static async testSecondCallSkipped(direction, t) {
    const reason = await LinkingTest.skipReason(direction);
    if (reason !== null) {
      t.skip(reason);
      return;
    }
    const setup = await LinkingTest.setUp(direction, 2);
    const run = await LinkingTest.run(setup, "", "allow");
    // The runtime shows the card before it checks the limits, so each call has one.
    t.diagnostic(`Consent cards shown: ${run.cards.length}`);
    assert.equal(LinkingTest.events(run.trace, "remote_call", "start").length, 1, "The partner ran more than once.");
    assert.equal(setup.router.partnerChats().length, 1);
    const results = LinkingTest.lastResults(setup.router);
    assert.equal(results.length, 2);
    assert.match(MockRouter.partnerText(results[0]), /^PARTNER_ANSWER: /);
    assert.equal(results[1], `Skipped ${setup.label}: that network was already consulted for this query. Continue with available results and do not retry it.`);
    assert.deepEqual(LinkingTest.paths(setup.web.requestsTo(setup.partnerOrigin, "runtime"), setup.partnerOrigin), [
      "/agent-manifest.json",
      `/${setup.partner.file}`,
      "/links.json",
    ]);
  }

  /**
   * L7: when the calling site's manifest does not allow the partner's origin, the runtime
   * refuses the call and contacts no one.
   *
   * :param direction: The direction's name.
   * :param t: The test context.
   */
  static async testPolicyRefusal(direction, t) {
    const reason = await LinkingTest.skipReason(direction);
    if (reason !== null) {
      t.skip(reason);
      return;
    }
    const setup = await LinkingTest.setUp(direction, 1);
    const manifest = structuredClone(setup.callerManifest);
    const allowed = [];
    for (const origin of manifest.allowed_peers || []) {
      if (origin !== setup.partnerOrigin) {
        allowed.push(origin);
      }
    }
    manifest.allowed_peers = allowed;
    setup.web.replace(`${setup.callerOrigin}/agent-manifest.json`, manifest);
    const run = await LinkingTest.run(setup, "", "allow");
    // The runtime shows the card before it checks the policy.
    t.diagnostic(`Consent cards shown: ${run.cards.length}`);
    assert.deepEqual(setup.web.requestsTo(setup.partnerOrigin, null), [], "A refused call contacted the partner.");
    assert.deepEqual(setup.router.partnerChats(), []);
    assert.deepEqual(LinkingTest.lastResults(setup.router), [
      `Error from tool '${setup.tool}': Policy: ${setup.partnerHost} is not in ${setup.caller.name}'s allowed_peers; refusing to contact it.`,
    ]);
  }

  /**
   * L9: a partner network that fails validation never runs: the calling site gets an
   * "Error from tool" result, and the partner makes no model call.
   *
   * :param direction: The direction's name.
   * :param t: The test context.
   */
  static async testInvalidPartner(direction, t) {
    const reason = await LinkingTest.skipReason(direction);
    if (reason !== null) {
      t.skip(reason);
      return;
    }
    const setup = await LinkingTest.setUp(direction, 1);
    const config = structuredClone(setup.partner.config);
    const front = setup.partner.network.findFrontMan();
    for (const agent of config.tools) {
      if (agent.name === front) {
        agent.tools = (agent.tools || []).concat(["no_such_tool"]);
      }
    }
    setup.web.replace(`${setup.partnerOrigin}/${setup.partner.file}`, config);
    const run = await LinkingTest.run(setup, "", "allow");
    assert.equal(run.cards.length, 1);
    assert.deepEqual(setup.router.partnerChats(), [], "A partner that fails validation made a model call.");
    assert.deepEqual(setup.web.frames, []);
    assert.deepEqual(LinkingTest.lastResults(setup.router), [
      `Error from tool '${setup.tool}': Network '${setup.partner.name}' (${setup.partnerHost}) failed validation: Agent '${front}' references missing tool 'no_such_tool'.`,
    ]);
  }

  /**
   * List the files under a folder, as paths relative to it.
   *
   * :param folder: The folder.
   * :return: The sorted relative paths.
   */
  static async filesUnder(folder) {
    const entries = await readdir(folder, {
      recursive: true,
      withFileTypes: true,
    });
    const files = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        files.push(path.relative(folder, path.join(entry.parentPath, entry.name)));
      }
    }
    return files.sort();
  }

  /**
   * Run the skill's build with --check.
   *
   * :param folder: The site folder.
   * :param name: The network name.
   * :param runtime: The runtime folder to build with, or null for the site's own.
   * :return: The exit code and output.
   */
  static async buildCheck(folder, name, runtime) {
    const args = [
      path.join(LinkingTest.REPO, "skills", "agentify-website", "scripts", "build_network.mjs"),
      path.join(folder, `${name}.hocon`),
      "--manifest",
      path.join(folder, "agent-manifest.json"),
      "--check",
    ];
    if (runtime !== null) {
      args.push("--runtime", runtime);
    }
    try {
      const done = await promisify(execFile)(process.execPath, args);
      return {
        code: 0,
        output: done.stdout,
      };
    } catch (error) {
      return {
        code: error.code,
        output: String(error.stdout || error.message),
      };
    }
  }

  /**
   * Check that a site keeps the template's peer and partner rules, with its own read
   * action filled in, and that the build finds nothing to report.
   *
   * :param folder: The site folder.
   * :param runtime: The runtime folder to build with, or null for the site's own.
   */
  static async checkRulesAndBuild(folder, runtime) {
    const site = await LinkingTest.readSite(folder);
    const template = parseHocon(await readFile(path.join(LinkingTest.REPO, "skills", "agentify-website", "templates", "network.hocon"), "utf8"));
    const rules = template.commondefs.replacement_strings;
    const source = parseHocon(await readFile(path.join(folder, `${site.name}.hocon`), "utf8"));
    const strings = (source.commondefs || {}).replacement_strings || {};
    assert.equal(strings.peer_rules, rules.peer_rules, "peer_rules differs from the template's.");
    let callsPartner = false;
    for (const agent of site.network.config.tools || []) {
      for (const ref of agent.tools || []) {
        if (site.network.classifyTool(ref).kind === "remote") {
          callsPartner = true;
        }
      }
    }
    if (callsPartner) {
      // Action names may hold "-", as the build allows.
      const match = /give its link from website_([A-Za-z][\w-]*)\./.exec(String(strings.partner_rules));
      assert.ok(match, "partner_rules does not name the read action with the partner's link.");
      assert.ok((site.manifest.actions.agentTools || []).includes(match[1]), `partner_rules names website_${match[1]}, which is not in agentTools.`);
      assert.equal(strings.partner_rules, rules.partner_rules.replace("website_<read_action>", `website_${match[1]}`), "partner_rules differs from the template's.");
    } else {
      assert.equal(strings.partner_rules, undefined, "The site calls no partner, but keeps partner_rules.");
    }
    const build = await LinkingTest.buildCheck(folder, site.name, runtime);
    assert.equal(build.code, 0, build.output);
    assert.doesNotMatch(build.output, /WARNING/, build.output);
  }

  /**
   * L8: an example keeps the skill's runtime byte for byte and the template's rules, and
   * its build --check reports nothing.
   *
   * :param role: "guesthouse" or "tours".
   * :param t: The test context.
   */
  static async testExampleMatchesSkill(role, t) {
    const sites = LinkingTest.sites();
    const folder = sites[role];
    if (role === "tours" && !sites.realTours) {
      t.skip("examples/harbor_tours_agentified does not exist yet.");
      return;
    }
    const site = await LinkingTest.readSite(folder);
    assert.ok(!site.manifest.actions || site.manifest.actions.bridge, `${folder} has no actions.bridge, so other sites cannot call it.`);
    const skillRuntime = path.join(LinkingTest.REPO, "skills", "agentify-website", "runtime");
    const files = await LinkingTest.filesUnder(skillRuntime);
    assert.deepEqual(await LinkingTest.filesUnder(path.join(folder, "runtime")), files, "The example's runtime/ has other files than the skill's.");
    for (const file of files) {
      const expected = await readFile(path.join(skillRuntime, file));
      const actual = await readFile(path.join(folder, "runtime", file));
      assert.ok(expected.equals(actual), `runtime/${file} differs from the skill's. Copy runtime/ again.`);
    }
    await LinkingTest.checkRulesAndBuild(folder, null);
  }

  /**
   * L10: a second hop. The test caller asks the tour site, and the tour site's network asks
   * the guesthouse. Each hop shows its own card before any contact, every model call runs
   * on the calling site's model, and the key goes only to the router. With the tour site's
   * allowed_peers empty, the second hop is refused by the tour site's own policy, and the
   * guesthouse is never contacted.
   *
   * :param allowed: False to serve the tour site with an empty allowed_peers.
   */
  static async testSecondHop(allowed) {
    const setup = await LinkingTest.setUpSecondHop(allowed);
    const run = await LinkingTest.run(setup, "", "allow");
    const web = setup.web;
    const guesthouse = LinkingTest.ORIGINS.guesthouse;
    assert.ok(run.cards.length >= 1, "No card was shown for the tour site.");
    assert.equal(run.cards[0].peerLabel, setup.label);
    assert.equal(run.cards[0].peerOrigin, new URL(setup.partnerOrigin).host);
    assert.deepEqual(LinkingTest.paths(web.requests.slice(0, run.cards[0].before), setup.partnerOrigin), [], "The tour site was contacted before its card was answered.");
    for (const record of web.requests) {
      if (record.origin !== new URL(LinkingTest.ROUTER).origin) {
        assert.equal(record.keySent, false, `${record.url} got the key.`);
        assert.equal(record.authorization, false, `${record.url} got an Authorization header.`);
      }
    }
    assert.deepEqual(web.unexpected, []);
    assert.ok(setup.callerModel, "The test caller's front agent names no model.");
    for (const record of setup.router.records) {
      if (record.kind === "chat") {
        assert.equal(record.model, setup.callerModel, `A ${record.role} model call did not use the calling site's model.`);
        assert.equal(record.keyOk, true, `A ${record.role} model call did not carry the visitor's key.`);
      }
    }
    const tourChats = setup.router.partnerChats();
    assert.ok(tourChats.length >= 2, "The tour site never got the guesthouse's answer.");
    if (allowed) {
      assert.equal(run.cards.length, 2, "Expected one card for each hop.");
      assert.equal(run.cards[1].peerOrigin, new URL(guesthouse).host);
      assert.equal(run.cards[1].requestText, LinkingTest.SECOND_HOP.onward);
      assert.deepEqual(LinkingTest.paths(web.requests.slice(0, run.cards[1].before), guesthouse), [], "The guesthouse was contacted before its card was answered.");
      assert.ok(setup.router.nestedChats().length >= 1, "The guesthouse made no model call.");
      assert.match(run.result.text, /^CALLER_FINAL: PARTNER_ANSWER: NESTED_ANSWER: peer rule yes; no-actions note yes\.$/);
    } else {
      assert.deepEqual(LinkingTest.paths(web.requests, guesthouse), [], "The guesthouse was contacted although the tour site's allowed_peers is empty.");
      assert.match(tourChats.at(-1).toolResults[0], /^Error from tool '[A-Za-z0-9_]+': Policy: 127\.0\.0\.1:8080 is not in /);
    }
  }

  /**
   * L8 for the test sites: they keep the template's rules, and their build --check with
   * the skill's runtime reports nothing.
   *
   * :param role: "caller" for caller_site, or "partner" for partner_site.
   */
  static async testFixtureMatchesSkill(role) {
    const folder = path.join(LinkingTest.REPO, "tests", "linking", "fixtures", `${role}_site`);
    await LinkingTest.checkRulesAndBuild(folder, path.join(LinkingTest.REPO, "skills", "agentify-website", "runtime"));
  }
}

test("L1 fixture caller -> guesthouse: one card, then the partner's files and bridge, on the caller's model", LinkingTest.testAllowedCall.bind(null, "caller-to-gh"));
test("L2 fixture caller -> guesthouse: the visitor's model is used by both sites", LinkingTest.testVisitorModel.bind(null, "caller-to-gh"));
test("L3 fixture caller -> guesthouse: a decline contacts no one", LinkingTest.testDecline.bind(null, "caller-to-gh"));
test("L5 fixture caller -> guesthouse: the partner is not offered a call back", LinkingTest.testNoCallBack.bind(null, "caller-to-gh"));
test("L6 fixture caller -> guesthouse: a second call is skipped and the partner runs once", LinkingTest.testSecondCallSkipped.bind(null, "caller-to-gh"));
test("L7 fixture caller -> guesthouse: a partner missing from allowed_peers is refused", LinkingTest.testPolicyRefusal.bind(null, "caller-to-gh"));
test("L9 fixture caller -> guesthouse: a partner that fails validation never runs", LinkingTest.testInvalidPartner.bind(null, "caller-to-gh"));
test("L1 guesthouse -> tour site: one card, then the partner's files and bridge, on the caller's model", LinkingTest.testAllowedCall.bind(null, "gh-to-tours"));
test("L2 guesthouse -> tour site: the visitor's model is used by both sites", LinkingTest.testVisitorModel.bind(null, "gh-to-tours"));
test("L3 guesthouse -> tour site: a decline contacts no one", LinkingTest.testDecline.bind(null, "gh-to-tours"));
test("L5 guesthouse -> tour site: the partner is not offered a call back", LinkingTest.testNoCallBack.bind(null, "gh-to-tours"));
test("L6 guesthouse -> tour site: a second call is skipped and the partner runs once", LinkingTest.testSecondCallSkipped.bind(null, "gh-to-tours"));
test("L7 guesthouse -> tour site: a partner missing from allowed_peers is refused", LinkingTest.testPolicyRefusal.bind(null, "gh-to-tours"));
test("L9 guesthouse -> tour site: a partner that fails validation never runs", LinkingTest.testInvalidPartner.bind(null, "gh-to-tours"));
test("L4 tour site -> guesthouse: one card, then the partner's files and bridge, on the caller's model", LinkingTest.testAllowedCall.bind(null, "tours-to-gh"));
test("L2 tour site -> guesthouse: the visitor's model is used by both sites", LinkingTest.testVisitorModel.bind(null, "tours-to-gh"));
test("L3 tour site -> guesthouse: a decline contacts no one", LinkingTest.testDecline.bind(null, "tours-to-gh"));
test("L5 tour site -> guesthouse: the partner is not offered a call back", LinkingTest.testNoCallBack.bind(null, "tours-to-gh"));
test("L6 tour site -> guesthouse: a second call is skipped and the partner runs once", LinkingTest.testSecondCallSkipped.bind(null, "tours-to-gh"));
test("L7 tour site -> guesthouse: a partner missing from allowed_peers is refused", LinkingTest.testPolicyRefusal.bind(null, "tours-to-gh"));
test("L9 tour site -> guesthouse: a partner that fails validation never runs", LinkingTest.testInvalidPartner.bind(null, "tours-to-gh"));
test("L10 fixture caller -> tour site -> guesthouse: each hop asks first, all on the caller's model", LinkingTest.testSecondHop.bind(null, true));
test("L10 fixture caller -> tour site -> guesthouse: the tour site's own allowed_peers refuses the second hop", LinkingTest.testSecondHop.bind(null, false));
test("L8 the guesthouse keeps the skill's runtime and rules, and builds clean", LinkingTest.testExampleMatchesSkill.bind(null, "guesthouse"));
test("L8 the tour site keeps the skill's runtime and rules, and builds clean", LinkingTest.testExampleMatchesSkill.bind(null, "tours"));
test("L8 the caller test site keeps the template's rules and builds clean", LinkingTest.testFixtureMatchesSkill.bind(null, "caller"));
test("L8 the partner test site keeps the template's rules and builds clean", LinkingTest.testFixtureMatchesSkill.bind(null, "partner"));

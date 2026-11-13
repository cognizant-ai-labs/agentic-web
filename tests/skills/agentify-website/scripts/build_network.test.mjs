// Checks skills/agentify-website/scripts/build_network.mjs on copies of a small linked site.
// Run from the repository root: node --test "tests/skills/agentify-website/scripts/*.test.mjs"
// Each test copies fixtures/linked_site to a temp folder, breaks one thing and runs the real
// script with the skill's runtime. Nothing is fetched and no model is called.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Runs the build on fixture copies and checks every message it prints.
 *
 * The fixture is a clean caller and callee: its manifest has actions, and it calls one
 * partner network. Each test asserts the exact list of warnings and errors, so a check
 * that fires by mistake fails the test too.
 */
class BuildNetworkTest {
  /**
   * The skill folder.
   */
  static SKILL = fileURLToPath(new URL("../../../../skills/agentify-website/", import.meta.url));

  /**
   * The fixture site that each test copies.
   */
  static FIXTURE = fileURLToPath(new URL("./fixtures/linked_site/", import.meta.url));

  /**
   * The partner network the fixture calls.
   */
  static PARTNER = "https://tours.example/harbor_tours";

  /**
   * The warning the fixture gets when no agent uses its allowed_peers entry.
   */
  static UNUSED_PEER = "WARNING: Manifest: allowed_peers lists https://tours.example, but no agent calls a network or MCP server there.";

  /**
   * Copy the fixture site to a new temp folder.
   *
   * :return: The temp folder.
   */
  static async copyFixture() {
    const folder = await mkdtemp(path.join(os.tmpdir(), "linked-site-"));
    await cp(BuildNetworkTest.FIXTURE, folder, { recursive: true });
    return folder;
  }

  /**
   * Delete a temp folder.
   *
   * :param folder: The folder to delete.
   */
  static async remove(folder) {
    await rm(folder, {
      recursive: true,
      force: true,
    });
  }

  /**
   * Run build_network.mjs on a site copy with the skill's runtime.
   *
   * :param folder: The site copy.
   * :param extra: More arguments, such as ["--check"].
   * :return: The exit code and the printed output.
   */
  static build(folder, extra) {
    const args = [
      path.join(BuildNetworkTest.SKILL, "scripts", "build_network.mjs"),
      path.join(folder, "seaside_desk.hocon"),
      "--manifest",
      path.join(folder, "agent-manifest.json"),
      "--runtime",
      path.join(BuildNetworkTest.SKILL, "runtime"),
    ];
    for (const arg of extra) {
      args.push(arg);
    }
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    return {
      code: result.status,
      out: `${result.stdout}${result.stderr}`,
    };
  }

  /**
   * Return the WARNING and ERROR lines of a build's output, in order.
   *
   * :param output: The printed output.
   * :return: The lines.
   */
  static findings(output) {
    const found = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("WARNING: ") || line.startsWith("ERROR: ")) {
        found.push(line);
      }
    }
    return found;
  }

  /**
   * Replace text in the copy's HOCON. The text must be there, so a fixture change cannot
   * make a test pass without breaking anything.
   *
   * :param folder: The site copy.
   * :param from: The text to replace, every time it appears.
   * :param to: The new text.
   */
  static async editHocon(folder, from, to) {
    const file = path.join(folder, "seaside_desk.hocon");
    const text = await readFile(file, "utf8");
    assert.ok(text.includes(from), `The fixture HOCON has no ${JSON.stringify(from)}.`);
    await writeFile(file, text.replaceAll(from, to));
  }

  /**
   * Read the copy's manifest.
   *
   * :param folder: The site copy.
   * :return: The parsed manifest.
   */
  static async readManifest(folder) {
    return JSON.parse(await readFile(path.join(folder, "agent-manifest.json"), "utf8"));
  }

  /**
   * Write the copy's manifest.
   *
   * :param folder: The site copy.
   * :param manifest: The manifest to write.
   */
  static async writeManifest(folder, manifest) {
    await writeFile(path.join(folder, "agent-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  /**
   * Point the copy at another partner URL, with that URL's origin in allowed_peers.
   *
   * :param folder: The site copy.
   * :param url: The new partner network URL.
   */
  static async setPartner(folder, url) {
    await BuildNetworkTest.editHocon(folder, BuildNetworkTest.PARTNER, url);
    const manifest = await BuildNetworkTest.readManifest(folder);
    manifest.allowed_peers = [new URL(url).origin];
    await BuildNetworkTest.writeManifest(folder, manifest);
  }

  /**
   * Build the copy once, so --check has files to compare.
   *
   * :param folder: The site copy.
   */
  static buildOnce(folder) {
    const result = BuildNetworkTest.build(folder, []);
    assert.equal(result.code, 0, result.out);
  }

  /**
   * The clean fixture builds with no warning or error, writes the bridge, reports the
   * partner, and passes --check afterwards.
   */
  static async testCleanSite() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), []);
      assert.ok(built.out.includes("Bridge: bridge/action-bridge.html (shares no actions)"), built.out);
      assert.ok(built.out.includes("Partner tools: harbor_tours -> https://tours.example/harbor_tours (\"Harbor Tours\")"), built.out);
      assert.ok(built.out.includes(path.join(folder, "bridge", "action-bridge.html")), built.out);
      assert.ok(built.out.includes(path.join(folder, "bridge", "agent-manifest.json")), built.out);
      const checked = BuildNetworkTest.build(folder, ["--check"]);
      assert.equal(checked.code, 0, checked.out);
      assert.deepEqual(BuildNetworkTest.findings(checked.out), []);
      assert.ok(checked.out.includes("OK: these files are up to date:"), checked.out);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * The bridge page is the skill's template, and the bridge manifest names only the
   * network, so the bridge shares no actions.
   */
  static async testBridgeFilesWritten() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      BuildNetworkTest.buildOnce(folder);
      const template = await readFile(path.join(BuildNetworkTest.SKILL, "templates", "bridge", "action-bridge.html"), "utf8");
      const page = await readFile(path.join(folder, "bridge", "action-bridge.html"), "utf8");
      assert.equal(page, template.replace(/\r\n/g, "\n"));
      assert.ok(page.includes("<script type=\"module\" src=\"../runtime/action-bridge.js\"></script>"));
      const bridgeManifest = await readFile(path.join(folder, "bridge", "agent-manifest.json"), "utf8");
      const expected = {
        networks: [
          {
            name: "seaside_desk",
          },
        ],
        actions: {
          version: 1,
        },
      };
      assert.equal(bridgeManifest, `${JSON.stringify(expected, null, 2)}\n`);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * --check fails when someone edits the bridge manifest, for example to add an action module.
   */
  static async testCheckFindsStaleBridge() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      BuildNetworkTest.buildOnce(folder);
      const file = path.join(folder, "bridge", "agent-manifest.json");
      const bridgeManifest = JSON.parse(await readFile(file, "utf8"));
      bridgeManifest.actions.module = "../site-actions.js";
      await writeFile(file, `${JSON.stringify(bridgeManifest, null, 2)}\n`);
      const checked = BuildNetworkTest.build(folder, ["--check"]);
      assert.equal(checked.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(checked.out), [
        `ERROR: ${file} is out of date with the HOCON or the manifest. Run without --check.`,
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * --check fails when the bridge page is missing.
   */
  static async testCheckFindsMissingBridge() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      BuildNetworkTest.buildOnce(folder);
      const file = path.join(folder, "bridge", "action-bridge.html");
      await rm(file);
      const checked = BuildNetworkTest.build(folder, ["--check"]);
      assert.equal(checked.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(checked.out), [
        `ERROR: ${file} does not exist. Run without --check to create it.`,
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A manifest without actions gets no bridge, and the build makes no bridge folder.
   */
  static async testNoActionsNoBridge() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const manifest = await BuildNetworkTest.readManifest(folder);
      delete manifest.actions;
      await BuildNetworkTest.writeManifest(folder, manifest);
      // Without actions there are no website_* tools to name.
      await BuildNetworkTest.editHocon(folder, "- Call website_get_desk_state for opening hours and the page's links.\n", "");
      await BuildNetworkTest.editHocon(folder, "give its link from website_get_desk_state", "say where to look instead");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      // With no read action to give the partner's link, the partner rule has to change,
      // and the build says so. Nothing warns about the bridge.
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: partner_rules differs from templates/network.hocon. Copy it unchanged, with website_<read_action> replaced by the read action that gives the partner's link.",
      ]);
      assert.ok(!built.out.includes("Bridge:"), built.out);
      assert.ok(!built.out.includes(`${path.sep}bridge${path.sep}`), built.out);
      await assert.rejects(stat(path.join(folder, "bridge")));
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * actions without bridge is an error that says what callers then do, and nothing is written.
   */
  static async testMissingBridgeIsAnError() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const manifest = await BuildNetworkTest.readManifest(folder);
      delete manifest.actions.bridge;
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "ERROR: Manifest: actions.bridge is missing. Other agent sites load it before they run this network; without it they wait 10 seconds, then ask their visitor to open a popup, and the network never runs. Add \"bridge\": \"./bridge/action-bridge.html\" to actions. The build writes that page.",
      ]);
      await assert.rejects(stat(path.join(folder, "bridge")));
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A bridge anywhere but bridge/action-bridge.html is an error, as in nsdeploy's layout.
   */
  static async testOtherBridgePathIsAnError() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.actions.bridge = "./action-bridge.html";
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "ERROR: Manifest: actions.bridge is \"./action-bridge.html\". Use \"./bridge/action-bridge.html\": the build writes that page with its own manifest, which shares no actions.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A partner given as a path on this site is an error.
   */
  static async testRelativePartnerIsAnError() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, "\"tools\": [\"https://tours.example/harbor_tours\"]", "\"tools\": [\"/harbor_tours\"]");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        BuildNetworkTest.UNUSED_PEER,
        "ERROR: seaside_assistant: partner \"/harbor_tours\" must be a full URL: the folder that holds the partner's agent-manifest.json, then its network name.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A partner URL with no network name, a trailing "/", a query or a "#" is an error.
   */
  static async testPartnerUrlMustEndInNetworkName() {
    const urls = [
      "https://tours.example/",
      "https://tours.example/harbor_tours/",
      "https://tours.example/harbor_tours?lang=en",
      "https://tours.example/harbor_tours#trips",
    ];
    for (const url of urls) {
      const folder = await BuildNetworkTest.copyFixture();
      try {
        await BuildNetworkTest.editHocon(folder, "\"tools\": [\"https://tours.example/harbor_tours\"]", `"tools": ["${url}"]`);
        const built = BuildNetworkTest.build(folder, []);
        assert.equal(built.code, 1, url);
        assert.deepEqual(BuildNetworkTest.findings(built.out), [
          BuildNetworkTest.UNUSED_PEER,
          `ERROR: seaside_assistant: partner ${url} must end in the network name, with no "/" at the end, no query and no "#", such as https://partner.example/partner_network.`,
        ]);
      } finally {
        await BuildNetworkTest.remove(folder);
      }
    }
  }

  /**
   * http is an error for a public host, and fine for localhost and 127.0.0.1. A partner
   * on this machine gets a note to replace it before hosting; an https partner does not.
   */
  static async testHttpOnlyOnLoopback() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.setPartner(folder, "http://tours.example/harbor_tours");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "ERROR: seaside_assistant: partner http://tours.example/harbor_tours uses http. Use https for every host but localhost and 127.0.0.1.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
    const local = [
      "http://localhost:8081/harbor_tours",
      "http://127.0.0.1:8081/harbor_tours",
    ];
    for (const url of local) {
      const copy = await BuildNetworkTest.copyFixture();
      try {
        await BuildNetworkTest.setPartner(copy, url);
        const built = BuildNetworkTest.build(copy, []);
        assert.equal(built.code, 0, built.out);
        assert.deepEqual(BuildNetworkTest.findings(built.out), []);
        assert.ok(built.out.includes(`  Before hosting: ${url} works only on this machine. Put the partner's https network URL in tools and link_labels, and its origin in allowed_peers, then build again. The tool name comes from the URL's path, so change the "How to work" line if the build then warns about it.`), built.out);
      } finally {
        await BuildNetworkTest.remove(copy);
      }
    }
    const hosted = await BuildNetworkTest.copyFixture();
    try {
      const built = BuildNetworkTest.build(hosted, []);
      assert.equal(built.code, 0, built.out);
      assert.ok(!built.out.includes("Before hosting"), built.out);
    } finally {
      await BuildNetworkTest.remove(hosted);
    }
  }

  /**
   * A partner whose origin is not in allowed_peers is an error, because the runtime refuses it.
   */
  static async testPartnerOriginNotAllowed() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.allowed_peers = [];
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "ERROR: seaside_assistant: https://tours.example/harbor_tours is not allowed. Add \"https://tours.example\" to allowed_peers in the manifest: the runtime refuses every other origin.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * MCP servers, as a URL or as an object with a url, need their origins in allowed_peers too.
   */
  static async testMcpOriginNotAllowed() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(
        folder,
        "\"tools\": [\"https://tours.example/harbor_tours\"]",
        "\"tools\": [\"https://tours.example/harbor_tours\", \"https://tools.example/mcp\", {\"url\": \"https://desk.example/mcp\"}]",
      );
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "ERROR: seaside_assistant: https://tools.example/mcp is not allowed. Add \"https://tools.example\" to allowed_peers in the manifest: the runtime refuses every other origin.",
        "ERROR: seaside_assistant: https://desk.example/mcp is not allowed. Add \"https://desk.example\" to allowed_peers in the manifest: the runtime refuses every other origin.",
      ]);
      assert.ok(built.out.includes("tools: [https://tours.example/harbor_tours, https://tools.example/mcp, https://desk.example/mcp]"), built.out);
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.allowed_peers = [
        "https://tours.example",
        "https://tools.example",
        "https://desk.example",
      ];
      await BuildNetworkTest.writeManifest(folder, manifest);
      const fixed = BuildNetworkTest.build(folder, []);
      assert.equal(fixed.code, 0, fixed.out);
      assert.deepEqual(BuildNetworkTest.findings(fixed.out), []);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * The open policy allows any partner, so it only warns.
   */
  static async testOpenPolicyWarns() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.allowed_peers = [];
      manifest.peer_policy.mode = "open";
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: Manifest: peer_policy.mode is \"open\", so the network may call any site. Use \"closed\" and list partners in allowed_peers.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A partner with no link_labels entry is an error that names the card's fallback label.
   */
  static async testMissingLabelIsAnError() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, "\"https://tours.example/harbor_tours\": \"Harbor Tours\"", "");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "ERROR: seaside_assistant: partner https://tours.example/harbor_tours has no link_labels entry, so the consent card would call it \"harbor_tours\". Add \"https://tours.example/harbor_tours\": \"<partner name>\" under link_labels.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * Instructions that never name the partner tool get a warning.
   */
  static async testInstructionsMustNameTool() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, "- For boat trips, call harbor_tours.\n", "");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: seaside_assistant: instructions do not say when to call harbor_tours, the tool for https://tours.example/harbor_tours.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * An agent that calls a partner but lacks the partner rules gets a warning.
   */
  static async testPartnerRulesNeeded() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, "{partner_rules}\n", "");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: seaside_assistant: calls a partner, but its instructions lack {partner_rules}. Keep the template's partner rules.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * An agent with the partner rules but no partner tool gets a warning.
   */
  static async testPartnerRulesWithoutPartner() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, "\"tools\": [\"https://tours.example/harbor_tours\"]", "\"tools\": []");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: seaside_assistant: instructions include {partner_rules}, but the agent calls no partner site. Delete them and the partner_rules string.",
        BuildNetworkTest.UNUSED_PEER,
      ]);
      assert.ok(!built.out.includes("Partner tools:"), built.out);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * link_slots gets a warning: an unbound slot makes the chat ask the visitor for a URL.
   */
  static async testLinkSlotsWarn() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, "    \"commondefs\": {", "    \"link_slots\": {\n        \"tour_desk\": {\n            \"callers\": [\"seaside_assistant\"]\n        }\n    },\n\n    \"commondefs\": {");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: link_slots makes the chat ask the visitor for a URL and allows that origin for the whole page. Name the partner's full URL in tools instead.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A non-empty linking.imports gets a warning.
   */
  static async testLinkingImportsWarn() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.linking.imports = ["tour_desk"];
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: Manifest: linking.imports lists link slots, which this skill does not use. Leave it empty and name each partner by its URL in tools.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * An allowed_peers entry that is not an exact origin warns, though the runtime still matches it.
   */
  static async testAllowedPeerNotOrigin() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.allowed_peers = ["https://tours.example/"];
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: Manifest: allowed_peers entry \"https://tours.example/\" is not an origin. List only the scheme, host and port, such as \"https://partner.example\".",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * An allowed_peers origin that no tool uses gets a warning.
   */
  static async testUnusedAllowedPeer() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.allowed_peers.push("https://unused.example");
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: Manifest: allowed_peers lists https://unused.example, but no agent calls a network or MCP server there.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A front agent without the peer rules gets a warning.
   */
  static async testPeerRulesNeeded() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, "{peer_rules}\n", "");
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        "WARNING: seaside_assistant: instructions lack {peer_rules}. Other agent sites can run this network; keep the template's peer rules.",
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A partner listed twice in one agent's tools is an error: keep one.
   */
  static async testDoubledPartnerIsAnError() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, `"tools": ["${BuildNetworkTest.PARTNER}"]`, `"tools": ["${BuildNetworkTest.PARTNER}", "${BuildNetworkTest.PARTNER}"]`);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        `ERROR: seaside_assistant: lists partner ${BuildNetworkTest.PARTNER} twice. Keep one.`,
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A partner whose tool name is the name of one of the agent's own tools is an error, in
   * either order: the runtime keeps the later one, so the other can never be called.
   */
  static async testPartnerNamedLikeOwnAgentIsAnError() {
    const orders = [
      `"tools": ["${BuildNetworkTest.PARTNER}", "harbor_tours"]`,
      `"tools": ["harbor_tours", "${BuildNetworkTest.PARTNER}"]`,
    ];
    for (const tools of orders) {
      const folder = await BuildNetworkTest.copyFixture();
      try {
        await BuildNetworkTest.editHocon(folder, `"tools": ["${BuildNetworkTest.PARTNER}"]`, `${tools}\n        },\n        {\n            "name": "harbor_tours",\n            "function": {\n                "description": "Answers questions about the desk's own boat list."\n            },\n            "instructions": """\nYou list the desk's own boats.\n{grounding_rules}\n""",\n            "tools": []`);
        const built = BuildNetworkTest.build(folder, []);
        assert.equal(built.code, 1, built.out);
        const expected = `ERROR: seaside_assistant: partner ${BuildNetworkTest.PARTNER} becomes the tool harbor_tours, which the tool harbor_tours already uses, so the model can call only one of them. Rename this site's own tool, or drop the partner.`;
        assert.ok(BuildNetworkTest.findings(built.out).includes(expected), built.out);
      } finally {
        await BuildNetworkTest.remove(folder);
      }
    }
  }

  /**
   * Two partner URLs with the same path, on different hosts, become one tool name, so the
   * model could call only the last one. That is an error.
   */
  static async testSameToolNameIsAnError() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      const other = "https://other.example/harbor_tours";
      await BuildNetworkTest.editHocon(folder, `"tools": ["${BuildNetworkTest.PARTNER}"]`, `"tools": ["${BuildNetworkTest.PARTNER}", "${other}"]`);
      await BuildNetworkTest.editHocon(folder, `"${BuildNetworkTest.PARTNER}": "Harbor Tours"`, `"${BuildNetworkTest.PARTNER}": "Harbor Tours",\n        "${other}": "Other Tours"`);
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.allowed_peers.push("https://other.example");
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 1, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), [
        `ERROR: seaside_assistant: partners ${BuildNetworkTest.PARTNER} and ${other} both become the tool harbor_tours, so the model can call only the last one. Keep one of them.`,
      ]);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A read action with "-" in its name, which the runtime allows, fills the partner rule
   * without a false warning that the rule differs from the template.
   */
  static async testHyphenatedReadAction() {
    const folder = await BuildNetworkTest.copyFixture();
    try {
      await BuildNetworkTest.editHocon(folder, "website_get_desk_state", "website_get-desk-state");
      const manifest = await BuildNetworkTest.readManifest(folder);
      manifest.actions.agentTools = ["get-desk-state"];
      await BuildNetworkTest.writeManifest(folder, manifest);
      const built = BuildNetworkTest.build(folder, []);
      assert.equal(built.code, 0, built.out);
      assert.deepEqual(BuildNetworkTest.findings(built.out), []);
    } finally {
      await BuildNetworkTest.remove(folder);
    }
  }

  /**
   * A peer or partner rule with a sentence dropped warns, though the phrase the other
   * checks look for is still there.
   */
  static async testChangedRulesWarn() {
    const cases = [
      {
        from: " Do not ask for names, emails, phone numbers or codes.",
        warning: "WARNING: peer_rules differs from templates/network.hocon. Copy it unchanged.",
      },
      {
        from: " never show its forms,",
        warning: "WARNING: partner_rules differs from templates/network.hocon. Copy it unchanged, with website_<read_action> replaced by the read action that gives the partner's link.",
      },
    ];
    for (const item of cases) {
      const folder = await BuildNetworkTest.copyFixture();
      try {
        await BuildNetworkTest.editHocon(folder, item.from, "");
        const built = BuildNetworkTest.build(folder, []);
        assert.equal(built.code, 0, built.out);
        assert.deepEqual(BuildNetworkTest.findings(built.out), [item.warning]);
      } finally {
        await BuildNetworkTest.remove(folder);
      }
    }
  }

  /**
   * The default instruction budget is 5,000 characters, and its warning says what to shorten.
   */
  static async testInstructionBudget() {
    const sizes = [
      4500,
      5200,
    ];
    for (const size of sizes) {
      const folder = await BuildNetworkTest.copyFixture();
      try {
        // The clean instructions are well under 4,000 characters; pad them to the size.
        const before = BuildNetworkTest.build(folder, []);
        const match = before.out.match(/seaside_assistant: (\d+) instruction chars/);
        assert.ok(match, before.out);
        const sentence = "Seaside Desk is by the harbor. ";
        const padding = `- ${sentence.repeat(Math.ceil((size - Number(match[1])) / sentence.length))}\n`;
        await BuildNetworkTest.editHocon(folder, "{partner_rules}\n", `${padding}{partner_rules}\n`);
        const built = BuildNetworkTest.build(folder, []);
        assert.equal(built.code, 0, built.out);
        const findings = BuildNetworkTest.findings(built.out);
        if (size < 5000) {
          assert.deepEqual(findings, []);
        } else {
          assert.equal(findings.length, 1, built.out);
          assert.match(findings[0], /^WARNING: seaside_assistant: instructions are \d+ characters after expansion \(budget 5000; the runtime adds about 2,000 more\)\. Shorten the site's own lines, not the template's rules\.$/);
        }
      } finally {
        await BuildNetworkTest.remove(folder);
      }
    }
  }
}

test("the clean fixture builds with no findings and passes --check", BuildNetworkTest.testCleanSite);
test("the bridge page is the template and its manifest shares no actions", BuildNetworkTest.testBridgeFilesWritten);
test("--check fails on an edited bridge manifest", BuildNetworkTest.testCheckFindsStaleBridge);
test("--check fails on a missing bridge page", BuildNetworkTest.testCheckFindsMissingBridge);
test("a manifest without actions gets no bridge", BuildNetworkTest.testNoActionsNoBridge);
test("actions without a bridge is an error", BuildNetworkTest.testMissingBridgeIsAnError);
test("a bridge outside bridge/ is an error", BuildNetworkTest.testOtherBridgePathIsAnError);
test("a partner given as a path is an error", BuildNetworkTest.testRelativePartnerIsAnError);
test("a partner URL must end in the network name", BuildNetworkTest.testPartnerUrlMustEndInNetworkName);
test("http is an error except on localhost and 127.0.0.1, which get a note before hosting", BuildNetworkTest.testHttpOnlyOnLoopback);
test("a partner origin missing from allowed_peers is an error", BuildNetworkTest.testPartnerOriginNotAllowed);
test("an MCP origin missing from allowed_peers is an error", BuildNetworkTest.testMcpOriginNotAllowed);
test("the open peer policy warns", BuildNetworkTest.testOpenPolicyWarns);
test("a partner without a link label is an error", BuildNetworkTest.testMissingLabelIsAnError);
test("instructions that never name the partner tool warn", BuildNetworkTest.testInstructionsMustNameTool);
test("a partner caller without partner rules warns", BuildNetworkTest.testPartnerRulesNeeded);
test("partner rules without a partner warn", BuildNetworkTest.testPartnerRulesWithoutPartner);
test("link_slots warns", BuildNetworkTest.testLinkSlotsWarn);
test("a non-empty linking.imports warns", BuildNetworkTest.testLinkingImportsWarn);
test("an allowed_peers entry that is not an origin warns", BuildNetworkTest.testAllowedPeerNotOrigin);
test("an unused allowed_peers origin warns", BuildNetworkTest.testUnusedAllowedPeer);
test("a front agent without peer rules warns", BuildNetworkTest.testPeerRulesNeeded);
test("peer and partner rules that differ from the template warn", BuildNetworkTest.testChangedRulesWarn);
test("two partners that become one tool name are an error", BuildNetworkTest.testSameToolNameIsAnError);
test("a partner listed twice is an error", BuildNetworkTest.testDoubledPartnerIsAnError);
test("a partner named like the agent's own tool is an error, in either order", BuildNetworkTest.testPartnerNamedLikeOwnAgentIsAnError);
test("a read action with a hyphen fills the partner rule with no warning", BuildNetworkTest.testHyphenatedReadAction);
test("the instruction budget is 5,000 characters", BuildNetworkTest.testInstructionBudget);

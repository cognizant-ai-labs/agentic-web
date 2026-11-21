// Checks the "In use" line of the ⚙ AI model settings panel.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The keys are made-up strings. Nothing is sent anywhere.
import assert from "node:assert/strict";
import test from "node:test";
import { InUseLine } from "../../../../skills/agentify-website/runtime/in-use-line.js";
import { API_KEY_PROVIDERS } from "../../../../skills/agentify-website/runtime/ui.js";

/**
 * Tests the text of the "In use" line for each kind of setup.
 *
 * Each test builds a setup like the one the panel passes, from the engine's applied
 * router, model and key, and checks the line.
 */
class TestInUseLine {
  /**
   * A made-up key that ends in "9f2c".
   */
  static KEY = "otk_made-up-example-key-9f2c";

  /**
   * Build a setup with a real key on hosted Otari, then apply changes.
   *
   * :param changes: The fields to change.
   * :return: The setup.
   */
  static setup(changes = {}) {
    const base = {
      mock: false,
      key: TestInUseLine.KEY,
      router: "https://api.otari.ai/api/v1",
      model: "",
      siteModel: "alibaba/qwen3.8-flash",
      providers: API_KEY_PROVIDERS,
      viaThisSite: false,
    };
    return Object.assign(base, changes);
  }

  /**
   * A known provider shows by name, with the visitor's model and the key's last four
   * characters, and never the rest of the key.
   */
  static testKnownProvider() {
    const text = InUseLine.text(TestInUseLine.setup({ model: "alibaba/qwen3.8-flash" }));
    assert.equal(text, "In use: Otari · alibaba/qwen3.8-flash · key ending …9f2c");
    assert.ok(!text.includes(TestInUseLine.KEY.slice(0, -4)), "The line shows more of the key than its ending.");
  }

  /**
   * Every provider the panel lists shows by name, also with a trailing slash in its URL.
   */
  static testEveryListedProvider() {
    for (const provider of API_KEY_PROVIDERS) {
      const text = InUseLine.text(TestInUseLine.setup({ router: `${provider.router}/` }));
      assert.ok(text.startsWith(`In use: ${provider.name} · `), text);
    }
  }

  /**
   * Another Provider URL shows as its host, such as a local Ollama.
   */
  static testOtherProviderShowsHost() {
    const text = InUseLine.text(TestInUseLine.setup({
      router: "http://127.0.0.1:11434/v1",
      model: "gemma4:e4b",
    }));
    assert.equal(text, "In use: 127.0.0.1:11434 · gemma4:e4b · key ending …9f2c");
  }

  /**
   * Without a model of the visitor's own, the line names the site's model, or says that
   * none is set.
   */
  static testSiteModel() {
    assert.match(InUseLine.text(TestInUseLine.setup()), /· alibaba\/qwen3\.8-flash \(this site's model\) ·/);
    assert.match(InUseLine.text(TestInUseLine.setup({ siteModel: "mock-1" })), /· no model set ·/);
  }

  /**
   * A key that this site's server passes on shows as "via this site".
   */
  static testViaThisSite() {
    const text = InUseLine.text(TestInUseLine.setup({
      router: "https://shop.example/byok/v1",
      viaThisSite: true,
    }));
    assert.ok(text.startsWith("In use: via this site · "), text);
  }

  /**
   * No key, the "demo" placeholder and the mock router each get their own short line.
   */
  static testNoKeyAndMock() {
    assert.equal(InUseLine.text(TestInUseLine.setup({ key: "" })), "In use: no key yet");
    assert.equal(InUseLine.text(TestInUseLine.setup({ key: "demo" })), "In use: no key yet");
    assert.equal(InUseLine.text(TestInUseLine.setup({ mock: true })), "In use: the demo mock, no real model");
  }

  /**
   * A short key is not shown at all, since its last four characters would be most of it.
   */
  static testShortKey() {
    assert.match(InUseLine.text(TestInUseLine.setup({ key: "abc12345" })), /· key set$/);
  }

  /**
   * A publisher-funded router says the site pays, with no key to show.
   */
  static testPublisherFunded() {
    assert.equal(
      InUseLine.text({publisherFunded: true, key: "", router: "https://funded.example/v1", model: "", siteModel: "alibaba/qwen3.8-flash"}),
      "In use: alibaba/qwen3.8-flash (this site's model) · paid for by this site, no key needed",
    );
  }
}

test("a known provider shows by name with the key's ending", TestInUseLine.testKnownProvider);
test("every listed provider shows by name", TestInUseLine.testEveryListedProvider);
test("another Provider URL shows as its host", TestInUseLine.testOtherProviderShowsHost);
test("the site's model is named when the visitor picked none", TestInUseLine.testSiteModel);
test("a key passed on by this site shows as via this site", TestInUseLine.testViaThisSite);
test("no key and the mock router get their own line", TestInUseLine.testNoKeyAndMock);
test("a short key is not shown", TestInUseLine.testShortKey);
test("a publisher-funded router says the site pays", TestInUseLine.testPublisherFunded);

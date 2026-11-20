// Checks the Connect with Otari sign-in against a mock otari.ai.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The mock answers every request and the keys are made up. Nothing is sent anywhere.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  getSelectedByokProfile,
  loadByokStore,
  loadTabByokSetup,
} from "../../../../skills/agentify-website/runtime/byok.js";
import { LlmClient } from "../../../../skills/agentify-website/runtime/llm.js";
import { OtariConnect } from "../../../../skills/agentify-website/runtime/otari-connect.js";
import { FakeBrowser } from "./fake_browser.mjs";
import { MockOpenRouter } from "./mock_openrouter.mjs";
import { MockOtari } from "./mock_otari.mjs";

/**
 * Tests the Otari sign-in: start(), finish() and the saved key.
 *
 * Each test opens a fake tab on a booking page, signs in on the mock otari.ai and checks
 * the address, the saved setup and the requests the mock received.
 */
class TestOtariConnect {
  /**
   * The page the visitor starts the sign-in from. Its query and fragment must come back.
   */
  static PAGE = "https://tours.example/book/?runner=langchain#chat";

  /**
   * The session storage item that holds the pending sign-in.
   */
  static PENDING = OtariConnect.PENDING_ITEM;

  /**
   * Open a fake tab on a page, with a fresh mock otari.ai.
   *
   * :param page: The page's address.
   * :param keyPrefix: The prefix of the keys the mock issues.
   * :return: The tab, already installed as the page's globals.
   */
  static open(page = TestOtariConnect.PAGE, keyPrefix = undefined) {
    const browser = new FakeBrowser(page, new MockOpenRouter(), new MockOtari(keyPrefix));
    browser.install();
    return browser;
  }

  /**
   * Start a sign-in and approve it on the mock, without finishing it.
   *
   * :param browser: The tab.
   * :return: The callback address the mock sent the visitor to.
   */
  static async approve(browser) {
    await OtariConnect.start();
    return browser.otari.approve(browser.assigned.at(-1));
  }

  /**
   * Change one field of the pending sign-in, as if the tab had kept another value.
   *
   * :param browser: The tab.
   * :param field: The field's name.
   * :param value: Its new value.
   */
  static editPending(browser, field, value) {
    const pending = JSON.parse(browser.session.getItem(TestOtariConnect.PENDING));
    pending[field] = value;
    browser.session.setItem(TestOtariConnect.PENDING, JSON.stringify(pending));
  }

  /**
   * start() sends the visitor to otari.ai with the site's origin as client ID, the page's
   * path as callback, an S256 challenge, a state and the suggested limit and expiry. The
   * verifier stays out of the URL.
   */
  static async testStartSendsChallenge() {
    const browser = TestOtariConnect.open();
    try {
      await OtariConnect.start();
      const authUrl = new URL(browser.assigned.at(-1));
      const pending = JSON.parse(browser.session.getItem(TestOtariConnect.PENDING));
      assert.equal(authUrl.origin + authUrl.pathname, "https://otari.ai/api/v1/oauth/apps/authorize");
      assert.equal(authUrl.searchParams.get("client_id"), "https://tours.example");
      assert.equal(authUrl.searchParams.get("redirect_uri"), "https://tours.example/book/");
      assert.equal(authUrl.searchParams.get("response_type"), "code");
      assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
      const challenge = createHash("sha256").update(pending.verifier).digest("base64url");
      assert.equal(authUrl.searchParams.get("code_challenge"), challenge);
      assert.equal(authUrl.searchParams.get("state"), pending.state);
      assert.equal(authUrl.searchParams.get("limit"), "5");
      assert.equal(authUrl.searchParams.get("expiration"), "30-days");
      assert.ok(pending.verifier.length >= 43, "A PKCE verifier needs at least 43 characters.");
      assert.ok(!authUrl.href.includes(pending.verifier), "The verifier must not be in the URL.");
    } finally {
      browser.restore();
    }
  }

  /**
   * After approval, finish() removes the reply from the address, saves the key as this
   * tab's Otari setup, and a model call then sends that key to otari.ai's US API.
   */
  static async testSignInSavesAndUsesKey() {
    const browser = TestOtariConnect.open();
    try {
      browser.visit(await TestOtariConnect.approve(browser));
      assert.ok(browser.search.includes("code="), "The mock did not send a code back.");
      const result = await OtariConnect.finish();
      assert.equal(result?.status, "connected");
      assert.equal(browser.href, TestOtariConnect.PAGE, "The reply stayed in the address.");
      assert.equal(browser.session.getItem(TestOtariConnect.PENDING), null);

      const setup = loadTabByokSetup();
      assert.equal(setup.key, "otk_v1_mock-key-1");
      assert.equal(setup.router, "https://api.otari.ai/api/v1");
      assert.equal(setup.model, OtariConnect.MODEL);
      assert.equal(getSelectedByokProfile()?.name, "Otari");

      const client = new LlmClient({ baseUrl: setup.router, apiKey: setup.key });
      await client.chat({ model: setup.model, messages: [{ role: "user", content: "Hi" }] });
      assert.equal(browser.otari.chats.length, 1);
      assert.equal(browser.otari.chats[0].host, "api.otari.ai");
      assert.equal(browser.otari.chats[0].authorization, `Bearer ${setup.key}`);
      assert.equal(browser.otari.chats[0].model, "alibaba/qwen3.8-flash");
    } finally {
      browser.restore();
    }
  }

  /**
   * A key from otari.ai's EU region is saved as an Otari EU setup and used against the EU
   * API, which is the only one that accepts it.
   */
  static async testEuKeyUsesEuApi() {
    const browser = TestOtariConnect.open(TestOtariConnect.PAGE, "otk_v1_eu_");
    try {
      browser.visit(await TestOtariConnect.approve(browser));
      assert.equal((await OtariConnect.finish())?.status, "connected");
      const setup = loadTabByokSetup();
      assert.equal(setup.router, "https://eu.api.otari.ai/api/v1");
      assert.equal(getSelectedByokProfile()?.name, "Otari EU");
      const client = new LlmClient({ baseUrl: setup.router, apiKey: setup.key });
      await client.chat({ model: setup.model, messages: [{ role: "user", content: "Hi" }] });
      assert.equal(browser.otari.chats[0].host, "eu.api.otari.ai");
    } finally {
      browser.restore();
    }
  }

  /**
   * A reply whose state differs from the one this tab sent is refused before any key
   * exchange, and the code is still removed from the address.
   */
  static async testWrongStateRefused() {
    const browser = TestOtariConnect.open();
    try {
      const back = new URL(await TestOtariConnect.approve(browser));
      back.searchParams.set("state", "someone-else");
      browser.visit(back.href);
      const result = await OtariConnect.finish();
      assert.equal(result?.status, "failed");
      assert.match(result.message, /did not match/);
      assert.equal(browser.href, TestOtariConnect.PAGE);
      assert.equal(browser.otari.exchanges.length, 0);
      assert.equal(loadTabByokSetup().key, "");
    } finally {
      browser.restore();
    }
  }

  /**
   * A reply that names another issuer is refused before any key exchange.
   */
  static async testWrongIssuerRefused() {
    const browser = TestOtariConnect.open();
    try {
      const back = new URL(await TestOtariConnect.approve(browser));
      back.searchParams.set("iss", "https://otari.example");
      browser.visit(back.href);
      const result = await OtariConnect.finish();
      assert.equal(result?.status, "failed");
      assert.match(result.message, /did not come from otari.ai/);
      assert.equal(browser.otari.exchanges.length, 0);
    } finally {
      browser.restore();
    }
  }

  /**
   * A code that otari.ai refuses, here because the verifier is wrong, saves nothing and
   * shows otari.ai's reason.
   */
  static async testRefusedCodeSavesNothing() {
    const browser = TestOtariConnect.open();
    try {
      browser.visit(await TestOtariConnect.approve(browser));
      TestOtariConnect.editPending(browser, "verifier", "not-the-verifier-sent-with-the-challenge-xx");
      const result = await OtariConnect.finish();
      assert.equal(result?.status, "failed");
      assert.match(result.message, /Invalid authorization code/);
      assert.equal(browser.otari.exchanges.length, 1);
      assert.equal(loadTabByokSetup().key, "");
      assert.equal(loadByokStore().profiles.length, 0);
    } finally {
      browser.restore();
    }
  }

  /**
   * Coming back after the visitor cancels on the consent screen ends the sign-in, says so
   * and saves nothing.
   */
  static async testDeniedSignIn() {
    const browser = TestOtariConnect.open();
    try {
      const back = new URL(await TestOtariConnect.approve(browser));
      back.searchParams.delete("code");
      back.searchParams.set("error", "access_denied");
      browser.visit(back.href);
      const result = await OtariConnect.finish();
      assert.equal(result?.status, "cancelled");
      assert.match(result.message, /cancelled/);
      assert.equal(browser.href, TestOtariConnect.PAGE);
      assert.equal(loadTabByokSetup().key, "");
      assert.equal(await OtariConnect.finish(), null, "A sign-in must finish only once.");
    } finally {
      browser.restore();
    }
  }

  /**
   * A page's own `code` parameter is left alone when this tab started no sign-in.
   */
  static async testPageCodeLeftAlone() {
    const page = "https://tours.example/book/?code=SPRING10";
    const browser = TestOtariConnect.open(page);
    try {
      assert.equal(await OtariConnect.finish(), null);
      assert.equal(browser.href, page);
      assert.equal(browser.otari.exchanges.length, 0);
    } finally {
      browser.restore();
    }
  }

  /**
   * Connecting again replaces the key in the same setup instead of adding another setup.
   */
  static async testConnectAgainKeepsOneSetup() {
    const browser = TestOtariConnect.open();
    try {
      for (let round = 0; round < 2; round += 1) {
        browser.visit(await TestOtariConnect.approve(browser));
        assert.equal((await OtariConnect.finish())?.status, "connected");
      }
      const otariSetups = loadByokStore().profiles.filter((profile) => profile.name === "Otari");
      assert.equal(otariSetups.length, 1);
      assert.equal(getSelectedByokProfile()?.key, "otk_v1_mock-key-2");
    } finally {
      browser.restore();
    }
  }

  /**
   * The Connect button works only in a secure context and when the page is not in a frame.
   */
  static testNeedsOwnSecureTab() {
    const browser = TestOtariConnect.open();
    try {
      assert.equal(OtariConnect.isAvailable(), true);
      globalThis.isSecureContext = false;
      assert.equal(OtariConnect.isAvailable(), false);
      globalThis.isSecureContext = true;
      globalThis.top = {};
      assert.equal(OtariConnect.isAvailable(), false);
    } finally {
      browser.restore();
    }
  }

  /**
   * A site on this computer's own address connects too: its origin, with the port, is its
   * client ID, and the callback is on that origin.
   */
  static async testLocalSiteSignsIn() {
    const page = "http://localhost:8080/";
    const browser = TestOtariConnect.open(page);
    try {
      assert.equal(OtariConnect.isAvailable(), true);
      await OtariConnect.start();
      const authUrl = new URL(browser.assigned.at(-1));
      assert.equal(authUrl.searchParams.get("client_id"), "http://localhost:8080");
      assert.equal(authUrl.searchParams.get("redirect_uri"), page);
      browser.visit(browser.otari.approve(authUrl.href));
      assert.equal((await OtariConnect.finish())?.status, "connected");
      assert.equal(browser.href, page);
      assert.equal(browser.otari.exchanges[0].client_id, "http://localhost:8080");
    } finally {
      browser.restore();
    }
  }
}

test("start() sends the origin, an S256 challenge, a state and the suggested limits", TestOtariConnect.testStartSendsChallenge);
test("a finished sign-in clears the address, saves the key and uses it", TestOtariConnect.testSignInSavesAndUsesKey);
test("an EU key is saved for the EU API", TestOtariConnect.testEuKeyUsesEuApi);
test("a reply with the wrong state is refused", TestOtariConnect.testWrongStateRefused);
test("a reply from another issuer is refused", TestOtariConnect.testWrongIssuerRefused);
test("a code otari.ai refuses saves nothing", TestOtariConnect.testRefusedCodeSavesNothing);
test("cancelling on the consent screen saves nothing", TestOtariConnect.testDeniedSignIn);
test("a page's own code parameter is left alone", TestOtariConnect.testPageCodeLeftAlone);
test("connecting again keeps one Otari setup", TestOtariConnect.testConnectAgainKeepsOneSetup);
test("the Connect button needs its own secure tab", TestOtariConnect.testNeedsOwnSecureTab);
test("a site on this computer's own address signs in", TestOtariConnect.testLocalSiteSignsIn);

// Checks which provider the settings panel finds for a pasted key.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The keys are made-up strings in each provider's format. Nothing is sent anywhere.
import assert from "node:assert/strict";
import test from "node:test";
import {
  API_KEY_PROVIDERS,
  providerForApiKey,
} from "../../../../skills/agentify-website/runtime/ui.js";

/**
 * Tests the provider list behind the ⚙ AI model settings panel.
 *
 * Each test checks the provider a key's prefix points to, and the settings it fills in.
 */
class SettingsPanelTest {
  /**
   * Return a made-up key: a prefix and 64 letters.
   *
   * :param prefix: The key's prefix.
   * :return: The key.
   */
  static fakeKey(prefix) {
    return prefix + "x".repeat(64);
  }

  /**
   * A hosted Otari key fills in hosted Otari and its model, and Otari is the first button.
   */
  static testHostedOtariKey() {
    const provider = providerForApiKey(SettingsPanelTest.fakeKey("otk_"));
    assert.equal(provider?.name, "Otari");
    assert.equal(provider.router, "https://api.otari.ai/api/v1");
    assert.equal(provider.model, "alibaba/qwen3.8-flash");
    assert.equal(API_KEY_PROVIDERS[0].name, "Otari", "Otari is not the first provider button.");
  }

  /**
   * A self-hosted Otari key matches no provider, so the panel keeps the Provider URL and asks
   * the visitor to check it.
   */
  static testSelfHostedOtariKey() {
    assert.equal(providerForApiKey(SettingsPanelTest.fakeKey("tk-")), null);
  }

  /**
   * The providers the panel knew before still match their keys.
   */
  static testOtherProviders() {
    const cases = [
      {
        prefix: "AIza",
        name: "Google AI Studio",
      },
      {
        prefix: "gsk_",
        name: "Groq",
      },
      {
        prefix: "sk-proj-",
        name: "OpenAI",
      },
      {
        prefix: "sk-ant-",
        name: "Anthropic",
      },
    ];
    for (const item of cases) {
      assert.equal(providerForApiKey(SettingsPanelTest.fakeKey(item.prefix))?.name, item.name);
    }
  }
}

test("a hosted Otari key fills in hosted Otari, the first provider", SettingsPanelTest.testHostedOtariKey);
test("a self-hosted Otari key matches no provider", SettingsPanelTest.testSelfHostedOtariKey);
test("the other providers still match their keys", SettingsPanelTest.testOtherProviders);

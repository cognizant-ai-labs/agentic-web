// Checks how the skill's runtime reads model replies from OpenAI-compatible routers.
// Run from the repository root: node --test "tests/**/*.test.mjs"
// The router is a stub fetch with a made-up key. No model is called.
import assert from "node:assert/strict";
import test from "node:test";
import { LlmClient } from "../../../../skills/agentify-website/runtime/llm.js";

/**
 * Tests LlmClient.chat against scripted router replies.
 *
 * Each test checks the tool calls or the retries the client returns for one reply.
 */
class LlmClientTest {
  /**
   * Return a streamed (SSE) Response whose chunks are the given deltas.
   *
   * :param deltas: The choices[0].delta objects, in order.
   * :return: The Response.
   */
  static sse(deltas) {
    const lines = deltas.map((delta, i) => `data: ${JSON.stringify({
      model: "gemini-test",
      choices: [{ index: 0, delta, finish_reason: i === deltas.length - 1 ? "tool_calls" : null }],
    })}\n\n`);
    lines.push("data: [DONE]\n\n");
    return new Response(lines.join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  /**
   * Run one chat call with fetch stubbed by the given function.
   *
   * :param fakeFetch: The stub fetch.
   * :return: The chat result.
   */
  static async chat(fakeFetch) {
    const realFetch = globalThis.fetch;
    const realTimeout = globalThis.setTimeout;
    globalThis.fetch = fakeFetch;
    globalThis.setTimeout = (fn) => realTimeout(fn, 0);
    try {
      const client = new LlmClient({ baseUrl: "https://router.test/v1", apiKey: "sk-test-not-a-real-key" });
      return await client.chat({
        model: "gemini-test",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "a", parameters: { type: "object" } } }],
      });
    } finally {
      globalThis.fetch = realFetch;
      globalThis.setTimeout = realTimeout;
    }
  }

  /**
   * Gemini streams parallel calls as whole chunks that share index 0. A new id is a new call,
   * so two calls come back instead of one call with joined arguments.
   */
  static async testParallelCallsWithSameIndex() {
    const result = await LlmClientTest.chat(async () => LlmClientTest.sse([
      { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "a", arguments: "{\"x\":1}" } }] },
      { tool_calls: [{ index: 0, id: "call_2", type: "function", function: { name: "b", arguments: "{\"y\":2}" } }] },
    ]));
    const calls = result.toolCalls.map((c) => [c.id, c.function.name, c.function.arguments]);
    assert.deepEqual(calls, [["call_1", "a", "{\"x\":1}"], ["call_2", "b", "{\"y\":2}"]]);
  }

  /**
   * OpenAI-style streams split one call's arguments over chunks with the same index and no
   * new id; they still join into one call.
   */
  static async testArgumentsSplitOverChunks() {
    const result = await LlmClientTest.chat(async () => LlmClientTest.sse([
      { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "a", arguments: "{\"x\":" } }] },
      { tool_calls: [{ index: 0, function: { arguments: "1}" } }] },
    ]));
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].function.arguments, "{\"x\":1}");
  }

  /**
   * Gemini 3 sends extra_content.google.thought_signature with a call and rejects the next
   * request when it is missing, so the client keeps it on the call.
   */
  static async testKeepsExtraContent() {
    const extra = { google: { thought_signature: "sig-abc" } };
    const result = await LlmClientTest.chat(async () => LlmClientTest.sse([
      { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "a", arguments: "{}" }, extra_content: extra }] },
    ]));
    assert.deepEqual(result.toolCalls[0].extra_content, extra);
  }

  /**
   * A 429 from a free tier is retried, and the next reply is used.
   */
  static async testRetriesRateLimit() {
    let requests = 0;
    const result = await LlmClientTest.chat(async () => {
      requests += 1;
      if (requests === 1) return new Response("rate limited", { status: 429 });
      return LlmClientTest.sse([
        { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "a", arguments: "{}" } }] },
      ]);
    });
    assert.equal(requests, 2);
    assert.equal(result.toolCalls.length, 1);
  }

  /**
   * A 401 is not retried: the visitor's key is wrong, and asking again will not help.
   */
  static async testDoesNotRetryAuthError() {
    let requests = 0;
    await assert.rejects(LlmClientTest.chat(async () => {
      requests += 1;
      return new Response("bad key", { status: 401 });
    }));
    assert.equal(requests, 1);
  }
}

test("parallel tool calls that share an index stay separate calls", LlmClientTest.testParallelCallsWithSameIndex);
test("one tool call's arguments split over chunks are joined", LlmClientTest.testArgumentsSplitOverChunks);
test("a tool call keeps extra_content (Gemini thought_signature)", LlmClientTest.testKeepsExtraContent);
test("a 429 reply is retried", LlmClientTest.testRetriesRateLimit);
test("a 401 reply is not retried", LlmClientTest.testDoesNotRetryAuthError);

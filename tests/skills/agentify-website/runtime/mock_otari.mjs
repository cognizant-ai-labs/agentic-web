import { createHash } from "node:crypto";
import { MockOpenRouter } from "./mock_openrouter.mjs";

/**
 * A mock otari.ai: its sign-in, its key exchange and the chat endpoint of each region.
 *
 * approve() plays the visitor approving on the consent screen. It returns the address
 * otari.ai would send the visitor back to. As otari.ai does with an unregistered site, it
 * accepts the sign-in only when the client ID is the callback's origin. The key exchange
 * checks the client, the callback and the PKCE verifier, and each code works once. Each
 * chat request records the key, model and region. The keys are made-up strings.
 */
export class MockOtari {
  /**
   * The page that starts the sign-in.
   */
  static AUTHORIZE_URL = "https://otari.ai/api/v1/oauth/apps/authorize";

  /**
   * The issuer otari.ai names in its reply.
   */
  static ISSUER = "https://otari.ai";

  /**
   * Start with no codes, exchanges or chat requests.
   *
   * :param keyPrefix: The prefix of the keys this mock issues, "otk_v1_eu_" for the EU region.
   */
  constructor(keyPrefix = "otk_v1_") {
    this.keyPrefix = keyPrefix;
    this.codes = new Map();
    this.approvals = [];
    this.exchanges = [];
    this.chats = [];
    this.issued = 0;
  }

  /**
   * Approve the sign-in on the mock consent screen.
   *
   * :param authUrl: The address the page sent the visitor to.
   * :return: The callback address with `code`, `state` and `iss`.
   * :raises Error: When the address is not the sign-in page, the client ID is not the
   *   callback's origin, or it has no S256 challenge.
   */
  approve(authUrl) {
    const url = new URL(authUrl);
    if (url.origin + url.pathname !== MockOtari.AUTHORIZE_URL) {
      throw new Error(`Not the otari.ai sign-in page: ${authUrl}`);
    }
    const params = url.searchParams;
    const back = new URL(params.get("redirect_uri"));
    if (params.get("client_id") !== back.origin || params.get("response_type") !== "code") {
      throw new Error("Unknown app or redirect URI");
    }
    const challenge = params.get("code_challenge") || "";
    if (!challenge || params.get("code_challenge_method") !== "S256") {
      throw new Error("The sign-in has no S256 code challenge.");
    }
    this.issued += 1;
    const code = `mock-code-${this.issued}`.padEnd(43, "x");
    this.codes.set(code, {
      challenge,
      clientId: params.get("client_id"),
      redirectUri: params.get("redirect_uri"),
      key: `${this.keyPrefix}mock-key-${this.issued}`,
    });
    this.approvals.push({ limit: params.get("limit"), expiration: params.get("expiration") });
    back.searchParams.set("code", code);
    back.searchParams.set("state", params.get("state") || "");
    back.searchParams.set("iss", MockOtari.ISSUER);
    return back.href;
  }

  /**
   * Answer a request to otari.ai or one of its APIs.
   *
   * :param url: The request's address.
   * :param init: The fetch options.
   * :return: The response.
   */
  async answer(url, init) {
    const { host, pathname } = new URL(url);
    if (init.method === "POST" && host === "otari.ai" && pathname === "/api/v1/oauth/apps/token") {
      return this.exchangeCode(init);
    }
    if (init.method === "POST" && pathname === "/api/v1/chat/completions") return this.chat(host, init);
    return MockOpenRouter.json(404, { detail: "Not Found" });
  }

  /**
   * Swap a code for a key when the client, the callback and the verifier match.
   *
   * :param init: The fetch options of the request.
   * :return: The key, or a 400 error as otari.ai sends it.
   */
  exchangeCode(init) {
    const body = Object.fromEntries(new URLSearchParams(String(init.body)));
    this.exchanges.push(body);
    const entry = this.codes.get(body.code);
    const challenge = createHash("sha256").update(String(body.code_verifier || "")).digest("base64url");
    const matches = entry && body.grant_type === "authorization_code" && body.client_id === entry.clientId
      && body.redirect_uri === entry.redirectUri && challenge === entry.challenge;
    if (!matches) {
      return MockOpenRouter.json(400, {
        error: "invalid_grant",
        error_description: "Invalid authorization code",
      });
    }
    this.codes.delete(body.code);
    return MockOpenRouter.json(200, {
      access_token: entry.key,
      token_type: "Bearer",
      scope: "inference:run",
      manage_url: "https://otari.ai/dashboard/keys",
    });
  }

  /**
   * Record a chat request's region, key and model, and answer with one streamed message.
   *
   * :param host: The API host the request went to.
   * :param init: The fetch options of the request.
   * :return: A server-sent events response with one chunk.
   */
  chat(host, init) {
    const body = JSON.parse(init.body);
    this.chats.push({
      host,
      authorization: new Headers(init.headers).get("authorization"),
      model: body.model,
    });
    const chunk = {
      model: body.model,
      choices: [
        {
          delta: { content: "Hello from the mock." },
          finish_reason: "stop",
        },
      ],
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
}

# Using Otari

[Otari](https://otari.ai) is an open-source LLM gateway with an OpenAI-compatible API.
An nsdeploy site can use it as its LLM router, either Mozilla's hosted Otari or one you
run yourself. The commands below assume nsdeploy is installed, as in the
[Quickstart](../../README.md#manually-generate-a-website-bundle). For other providers,
see [LLM providers](README.md).

Which setup works depends on how the site is served:

| Router | nsdeploy launcher (`python -m nsdeploy ... --upstream`) | Static bundle (`--static-bundle`) |
|---|---|---|
| Hosted Otari (`otari.ai`) | Works, through the site's `/byok/v1` relay | Does not work: hosted Otari blocks browser calls |
| Self-hosted Otari | Works | Works, if Otari allows the site's origin |

## How the page reaches the LLM

In the `⚙ BYOK / router settings` panel, the `API key`, `Model` and `Router base URL`
fields decide where LLM requests go. The browser sends each request to the Router base URL.

- **Launcher.** `python -m nsdeploy <network>.hocon --port 8080` serves the site and a
  relay at `/byok/v1`. If you enter a key and leave Router base URL empty, the page calls
  its own `/byok/v1`. The launcher forwards the request and your key to the `--upstream`
  URL (default `https://api.openai.com/v1`). It does not store the key.
- **Static bundle.** `--static-bundle` builds plain files with no server and no relay.
  The browser calls the router itself, so the router must allow browser calls (CORS).
  An empty Router base URL means the `--upstream` URL given at build time.

OpenAI allows browser calls, which is why the static bundle in the
[Quickstart](../../README.md#manually-generate-a-website-bundle) works with it. Hosted Otari
does not.

## Hosted Otari (otari.ai)

- The base URL is `https://api.otari.ai/api/v1`. Plain `/v1` returns 404.
- Hosted Otari does not allow browser calls. If Router base URL points straight at Otari,
  the chat shows `⚠️ Failed to fetch` and the browser console shows CORS errors. A correct
  key and URL don't help. Use the launcher's relay instead.

1. Start the site with Otari as the upstream:
   ```shell
   python -m nsdeploy examples/pizza_restaurant_website_assistant.hocon \
     --port 8080 --upstream https://api.otari.ai/api/v1
   ```
   The startup report should show
   `LLM default: BYOK /byok/v1 (API key required)  ·  BYOK upstream → https://api.otari.ai/api/v1`.
1. Open http://127.0.0.1:8080/ and expand `⚙ BYOK / router settings`:
   - API key: your Otari key.
   - Model: an exact model ID from Otari's catalog, for example `alibaba/qwen-3.5-35b-a3b`.
   - Router base URL: leave it empty, or enter `/byok/v1`.
1. Click `Apply, save & reload`, then chat.

Things to know:

- **Model IDs must match the catalog exactly.** Get them from `GET /api/v1/models`.
  A short name such as `qwen-3.5-35b` returns 400 `invalid_model`.
- **Pick a model that makes tool calls.** The front agent delegates to other agents
  through tool calls. A model that answers in plain text instead won't delegate.
- **All keys go to Otari.** With `--upstream` set to Otari, every key entered on that site
  is sent to Otari, so an OpenAI key won't work there.
- **Limit your key.** Use an Otari key with a spending limit, and revoke it when the
  workshop or test is over.

## Self-hosted Otari with local models

This runs Otari in Docker in front of [Ollama](https://ollama.com) on your machine, so
no LLM provider key is needed.

### 1. Pull a model

```shell
ollama pull gemma4:e4b
```

### 2. Make a key

You make up the Otari key yourself. Otari creates every key listed in its config when
it starts. This command writes a random key to `key.env` without printing it:

```shell
(umask 077; python3 -c "import secrets; print('OTARI_LOCAL_API_KEY=tk-' + secrets.token_urlsafe(48))" > key.env)
set -a; . ./key.env; set +a
```

The key only works on your local Otari. Keep `key.env` out of git.

### 3. Write `config.yml`

```yaml
database_url: "sqlite+aiosqlite:///./otari.db"
default_pricing: true
providers:
  ollama:
    api_base: "http://host.docker.internal:11434"
    models: [gemma4:e4b]
pricing:
  "ollama:gemma4:e4b":
    input_price_per_million: 0
    output_price_per_million: 0
cors_allow_origins:
  - "http://127.0.0.1:8080"
api_keys:
  local-test:
    secret: ${OTARI_LOCAL_API_KEY}
    user_id: local-test
```

- **`pricing`:** Otari refuses a model with no price (402). Give each local model you
  want to use a zero-price entry like the one above.
- **`cors_allow_origins`:** the origins of pages allowed to call Otari from the browser.
  You need it for a static bundle, or when Router base URL points straight at Otari. The
  launcher's `/byok/v1` relay doesn't need it.

Each origin must match the page's address exactly: scheme, host and port.
`http://localhost:8080` and `http://127.0.0.1:8080` are different origins. Avoid `"*"`,
which lets pages on any website call your gateway.

### 4. Start Otari

From the folder with `config.yml`, in the shell where you loaded `key.env`:

```shell
export OTARI_CONFIG_YAML="$(cat config.yml)"
docker run --rm --name otari-local --publish 127.0.0.1:8000:8000 \
  --env OTARI_LOCAL_API_KEY --env OTARI_CONFIG_YAML \
  mzdotai/otari:0.36.0 otari serve
```

Otari's base URL is now `http://127.0.0.1:8000/api/v1`. On Linux, `host.docker.internal`
may need `--add-host=host.docker.internal:host-gateway` on `docker run`.

### 5. Point the site at it

With the launcher:

```shell
python -m nsdeploy examples/pizza_restaurant_website_assistant.hocon \
  --port 8080 --upstream http://127.0.0.1:8000/api/v1
```

With a static bundle, build with the same `--upstream` and serve the files. This writes
to a new folder so the bundle checked into this repository stays as it is:

```shell
python -m nsdeploy examples/pizza_restaurant_website_assistant.hocon \
  --static-bundle --upstream http://127.0.0.1:8000/api/v1 \
  --out ./examples/sites/pizza_restaurant_otari_static
python -m http.server 8080 --directory ./examples/sites/pizza_restaurant_otari_static
```

A bundle built without `--upstream`, like the one in this repository, also works if you
set Router base URL to `http://127.0.0.1:8000/api/v1` in the panel.

Then open http://127.0.0.1:8080/ (not `localhost`, unless that is the origin you allowed)
and expand `⚙ BYOK / router settings`:

- API key: the value after `OTARI_LOCAL_API_KEY=` in `key.env`.
- Model: `google/gemma4-e4b` (or `ollama:gemma4:e4b`; both work).
- Router base URL: leave it empty.

Click `Apply, save & reload`, then chat.

Things to know:

- **Model IDs.** `GET /api/v1/models` lists local models under catalog-style IDs such as
  `google/gemma4-e4b`. It also lists other Ollama models found on the host. Those return
  402 until you add a pricing entry for them.
- **Local models are slow.** A multi-agent turn can take a minute or more.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Chat shows `⚠️ Failed to fetch`, console shows "blocked by CORS policy" | The browser is calling a router that doesn't allow this page. For hosted Otari, use the launcher and leave Router base URL empty. For self-hosted Otari, add the page's exact origin to `cors_allow_origins` and restart Otari. |
| The site keeps using an old router | The panel saves your setup in the browser. On `localhost` and `127.0.0.1` it is also kept in a cookie shared by every local port for 180 days, so a router saved for another site follows you. Clear Router base URL (or set it to `/byok/v1` on a launcher site), then `Apply, save & reload`. |
| 400 `invalid_model` | Use an exact model ID from `GET /api/v1/models`. |
| 402 "No pricing is configured" | Self-hosted: add a `pricing` entry for that model. |
| 404 "Otari serves its API under /api/v1" | The base URL must end in `/api/v1`, not `/v1`. |
| 401 "Invalid API key" | The key is wrong. Self-hosted: check that `OTARI_LOCAL_API_KEY` was set in the shell that ran `docker run`. |

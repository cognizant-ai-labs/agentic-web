# Linking tests

These checks show that skill-built sites link both ways: one site's network calls
another site's network in the visitor's browser, after the visitor agrees on a card, and
the key goes only to the visitor's router. They use a scripted router and the fake key
`sk-test-not-a-real-key`, so no model is called.

## Directions

| Direction | Calling site | Partner network |
| --- | --- | --- |
| `caller-to-gh` | the test caller, `http://localhost:8082/` | `http://127.0.0.1:8080/tidewhistle_guesthouse` |
| `gh-to-tours` | the guesthouse, `http://127.0.0.1:8080/` | `http://localhost:8081/marrow_point_harbor_tours`: the real tour site when `examples/harbor_tours_agentified` exists, else the test partner |
| `tours-to-gh` | the real tour site, `http://localhost:8081/` | `http://127.0.0.1:8080/tidewhistle_guesthouse` |

The two examples use two host names on purpose. On loopback hosts the runtime copies
saved keys into a cookie for the host name, on every port (`runtime/byok.js`), so a
partner on the same host name would get the key with its bridge requests. C7 shows this.

`tours-to-gh` and the tour site's L8 skip, with the reason, until there is a real tour
site: `examples/harbor_tours_agentified`, or the folder that `LINKING_TOURS` or `--tours`
names. A skip is not a pass. A direction whose sites are not linked fails, with the
reason: a site has no manifest, the partner has no `actions.bridge`, or the calling site
does not name the partner's URL in `tools`.

## Node tests

`linking.test.mjs` runs the skill's runtime in Node. `ExampleWeb` (`example_web.mjs`)
serves the site folders from disk under the URLs above through a stub `fetch`, answers
model requests with the scripted router, and stands in for the partner's bridge frame. No
port is used and nothing leaves the process. Run them with the other tests, from the
repository root:

```shell
node --test "tests/**/*.test.mjs"
```

| Case | Checks |
| --- | --- |
| L1, L4 | With no visitor model: one card with the partner's label (each of its words is in the partner's brand), host and the whole request, and nothing sent to the partner before the answer. Then its manifest, network file and `links.json`, and a frame for `bridge/action-bridge.html` with sandbox `allow-scripts allow-same-origin`. The partner runs on the calling site's model, with the key, on the router. No site gets the key or an `Authorization` header. The partner's first request has only a system and a user message, the `remote_call` trace has empty `sly_data`, and the partner's prompt holds the peer rule and the runtime's "No browser actions" note. The answer reaches the calling site. L4 is L1 from the tour site. When both sites name the same model, the test serves the partner's network naming another model, so it still shows that the calling site chose the partner's model. |
| L2 | A model the visitor picked is used by both sites. |
| L3 | A decline sends nothing at all to the partner. |
| L5 | The partner is not offered a call back to the calling site, so there is one card. When the partner does not call the calling site, the test adds that call to the served copy of its network. |
| L6 | A second call to the same partner in one message is skipped, and the partner runs once. |
| L7 | With the partner's origin missing from the calling site's `allowed_peers`, the call is refused and nothing goes to the partner. |
| L8 | Each example keeps `runtime/` byte for byte as the skill's, keeps the template's `peer_rules` and `partner_rules` (with its read action filled in), and builds with `--check` with no warning. The test sites get the same checks, without the runtime one. |
| L9 | A partner network that fails validation gives an "Error from tool" result and makes no model call. |
| L10 | A second hop: the test caller, served so that it names the tour site, calls the tour site, whose network calls the guesthouse. Each hop shows its own card before any contact, every model call runs on the test caller's model with the key, and no site gets the key. With the tour site's `allowed_peers` served empty, the second hop is refused by the tour site's own policy and the guesthouse is never contacted. |

The calling site's own `actions` are left out of its served manifest, because Node cannot
import its action module over HTTP. Each site's own tests cover its actions.

To test other copies of the sites, such as a fresh agent's output, set
`LINKING_GUESTHOUSE=<folder>` or `LINKING_TOURS=<folder>`.

## Chrome check

`chrome/run_linking_check.mjs` runs the same directions in headless Chrome, with real
servers on the addresses above:

```shell
node tests/linking/chrome/run_linking_check.mjs [--chrome <path>]
     [--direction both|caller-to-gh|gh-to-tours|tours-to-gh] [--same-host] [--no-bridge]
     [--guesthouse <folder>] [--tours <folder>] [--out <folder>]
```

- Each site runs under `skills/agentify-website/scripts/serve_site.mjs` with `--log`, bound
  to `127.0.0.1` and opened as `127.0.0.1` or `localhost`. The router listens on
  `127.0.0.1:8791` and Chrome's DevTools on port 9782.
- Chrome runs headless with a new profile, `--proxy-server=http://127.0.0.1:9` and
  `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"`, so it
  cannot reach a real host. `--chrome` or `CHROME` picks the binary; otherwise the usual
  install paths are tried. Without Chrome the check exits 2.
- It stops with exit 2 when a port it needs is in use. It stops every process it started
  when it ends, also after a failure or Ctrl+C.
- `--direction both`, the default, runs every direction, under the skip and fail rules in
  "Directions".
- The output goes to a new temp folder, or `--out`, never inside the repository:
  `summary.txt`, `report.json`, each case's evidence in `cases/`, the server and router
  logs in `logs/`, and the test sites it served in `sites/`. Chrome's profile, which holds
  the fake key, is deleted at the end. The check fails if the key appears in any other
  output file.

| Case | Checks |
| --- | --- |
| C1 | Visitor model set, Allow. The partner ran, and answered under 5 s after consent. One card, with the label, the partner's host and the whole request. The frame loaded the partner's `bridge/action-bridge.html` with sandbox `allow-scripts allow-same-origin`. The partner served only its manifest, network file, `links.json`, `bridge/` and `runtime/` files. No "Continue at" dialog. Only router requests carry the key, besides the runtime's cookie on the calling site's own host, and no partner request has `Authorization` or the `nsweb_byok_profiles_v1` cookie. Every chat request went to the router, on the visitor's model. The partner was offered no `website_*` tool. A note gives the calling page's action note after the call: the runtime shows the partner bridge's "No actions exposed" there, which is on the upstream list. |
| C2 | C1 with no visitor model: every chat request uses the calling site's front-agent model. When both sites name the same model, the check serves a copy of the partner whose network names another model, then serves the partner itself again, and a note says so. |
| C3 | Decline: no request at all reaches the partner's host. |
| C4 | C1 from the tour site to the guesthouse. It runs only with the real tour site. |
| C5 | Each site's own page, with no key: the keyless read check returns `succeeded`, and the status line shows "N website actions connected". |
| C6 | Each bridge page opened directly reads "Open this page through an agent action.", loads none of the site's own files, and logs no error. Chrome's own `/favicon.ico` request is not counted. |
| C7 | `--same-host`, for information: the calling page opened under the partner's host name. It reports whether the key cookie reached the partner's host. |
| C8 | `--no-bridge`, for information, for the first direction that runs: the partner served without its bridge. It reports the 10-second wait and the "Continue at" dialog. For another direction, pass it with `--direction`. |

Exit codes: 0 when every case that ran passed; 1 when one failed, a direction's sites are
not linked, or the key appears in the output; 2 when the check could not start or stopped
on an error; 3 when it ran past its 10-minute limit; 130 after Ctrl+C. C7 and C8 never fail
the run.

The router (`chrome/mock_router.mjs`) works for any skill-built network. A request whose
last user message is the scripted request comes from the partner: it answers
`PARTNER_ANSWER:` with whether its prompt holds the peer rule and the runtime's "No browser
actions" note. Only for L10, it first calls its own partner tool once with a second
request, and that partner answers `NESTED_ANSWER:`. Any other request comes from
the calling site: it calls the tool whose description starts with "Hand off to the", then
answers `CALLER_FINAL:` with the partner's text. It records the model, whether the key was
sent, the origin, the tool names and the message roles, never the key.

| File | Class | Does |
| --- | --- | --- |
| `chrome/run_linking_check.mjs` | `LinkingCheck` | Starts and stops every process, runs the cases, writes the report. |
| `chrome/chrome_launcher.mjs` | `ChromeLauncher` | Finds, starts and stops headless Chrome. |
| `chrome/cdp_client.mjs` | `CdpClient` | Talks to Chrome over the DevTools protocol. |
| `chrome/link_call_run.mjs` | `LinkCallRun` | Drives one visitor turn and records requests with header flags, never values. |
| `chrome/page_scripts.mjs` | `PageScripts` | The scripts it runs in the page. |
| `chrome/mock_router.mjs` | `MockRouter` | The scripted router, also used by the Node tests. |

## Test sites

`fixtures/` holds two small skill-style sites. Each has one front agent, one read action
with fixed data, a manifest with `actions.bridge`, and the template's rules.

- `caller_site`: Marrow Point Visitor Desk, network `marrow_point_visitor_desk`, served at
  `http://localhost:8082/`. It calls the guesthouse. Its model, `gpt-4.1-nano`, is not the
  guesthouse's, so a test can tell which site chose the model.
- `partner_site`: Marrow Point Harbor Tours, network `marrow_point_harbor_tours`, served at
  `http://localhost:8081/` while `examples/harbor_tours_agentified` does not exist. Its
  model is `gpt-4o-mini`. It calls the guesthouse back, as the real tour site will, so L5
  checks the call-back rule on a real network.

They hold no copy of the runtime. The Chrome check serves a copy of each, with the skill's
`runtime/` added, from its output folder. To serve one by hand, copy it somewhere outside
the repository and copy `skills/agentify-website/runtime` into it.

After a change, rebuild from the repository root, and run the Node tests (L8 checks the
build):

```shell
node skills/agentify-website/scripts/build_network.mjs tests/linking/fixtures/caller_site/marrow_point_visitor_desk.hocon --manifest tests/linking/fixtures/caller_site/agent-manifest.json --runtime skills/agentify-website/runtime
node skills/agentify-website/scripts/build_network.mjs tests/linking/fixtures/partner_site/marrow_point_harbor_tours.hocon --manifest tests/linking/fixtures/partner_site/agent-manifest.json --runtime skills/agentify-website/runtime
```

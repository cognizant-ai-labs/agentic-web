# Linking with other agent sites

## How a call works

Other agent websites can run this site's network, and this site's network can ask theirs.
A caller fetches the partner's public files and runs the partner's network in its own
visitor's browser, on that visitor's router and key, after the visitor agrees on a card.
Treat the request as sent to the partner: the partner's instructions read it, and its
network can pass it to an MCP server on the partner's own origin without another card.
Every other origin gets its own card. Each hop is checked against the `allowed_peers` of
the network that makes the call, so a partner's network can also ask the partner's own
partners, each after its own card (`runtime/engine.js`, `_assertAllowedPeer`).

- **The network URL** is the folder that holds `agent-manifest.json`, then the network
  name, such as `https://partner.example/partner_network`. A caller refuses any other
  name (`runtime/engine.js`, `resolveRemote`).
- **The consent card** shows the partner's label, its host and the first 140 characters
  of the request, before any contact (`runtime/runner.js`, `dispatchToolCall`, and
  `runtime/ui.js`, `mountApp`). The partner gets the whole request, so the partner rule
  tells the agent to keep it shorter than that. "Always allow" skips the card for that
  host until the page is reloaded (`runtime/engine.js`, `requestConsent`). A partner on
  the same origin gets no card (`runtime/runner.js`, `requiresThirdPartyApproval`). The
  policy and limit checks come after the card, so a call the visitor allowed can still
  be refused or skipped. A card for a site that a partner calls looks the same: it does
  not say that the partner asks, and the partner chose its label.
- **After Allow**, the caller fetches the partner's manifest, network file and
  `links.json`. If that manifest has `actions`, the caller also loads the partner's
  `actions.bridge` page in a hidden frame (`runtime/action-transport.js`,
  `registerRemoteActions`). Then it runs the partner's front agent with only the request
  text: no chat history and no `sly_data` (`runtime/runner.js`, `dispatchToolCall`).
- **The partner's model calls** go to the caller's router with the visitor's key, never
  to the partner (`runtime/engine.js`, `_compile`). They use the visitor's model or, when
  the visitor picked none, the calling site's front-agent model. Each partner agent stops
  at the calling site's step limit (`runtime/engine.js`, `_makeCtx`).
- **Limits per visitor message:** 4 partner calls, 1 per partner network, 24 agent calls
  and 90 s (`runtime/engine.js`, `runTurn`). The 90 s limit is checked when an agent or
  partner call starts; it does not stop one already running (`runtime/runner.js`,
  `consumeAgentBudget` and `consumeRemoteBudget`). The runtime also sets no timeout on a
  partner's files (`runtime/remote.js`, `fetchManifest` and `fetchText`, and
  `runtime/engine.js`, `_loadPublishedLinks`), so a partner that accepts the connection
  but never answers leaves the visitor's chat waiting until they reload the page. Calls
  nest at most 5 deep, counting the visitor's site (`runtime/remote.js`,
  `RemoteRegistry`).
- **Calls back.** The runtime drops a call back to the site that called it
  (`runtime/runner.js`, `buildToolTable`) only when the partner names that site's own
  network URL, with the site at a domain root and opened under the host name that URL
  names. Any other URL into the calling site is offered: its facts network, another
  network in its folder, the same network under a subpath, a bound link slot, or another
  host name. If the partner calls it, the visitor sees a card for the site they are on,
  or no card when both sites share an origin. Under a subpath, and for a bound link slot,
  allowing it only skips the call. Under another host name, such as `www.` and the bare
  domain, allowing it runs this site's network once more, with no site tools, on the
  visitor's key. A call into this site's facts network, or another network in its
  folder, also runs once more on the visitor's key, and a name the folder does not have
  fails. A facts network has no tools, so call a partner's facts URL when it has one.
  Redirect other host names to the one partners name.
- **Site tools.** Neither side gets the other's site tools: the runtime offers
  `website_*` tools only on the visitor's own site (`runtime/runner.js`,
  `buildToolTable`). So a partner's main network cannot list what it has, such as its
  rooms or menu, or give live availability, prices or bookings: it says what kinds of
  things it offers and that its page has the details. A partner that publishes a facts
  network answers from its dated public facts instead, such as its rooms or menu, with
  prices, times, rules and contact details ("Facts for callers"). No partner can give
  live availability or book: that stays on its own page. This site's own note about the
  partner may already say more. If a partner's bridge shares actions, its answer can still hold a button for one.
  `site.js` then shows the runtime's dialog, which names the partner's host, even when
  the action has the name of one of this site's.
- **Cost.** The card's token estimate counts only the request, so a call costs more than
  the card says (`runtime/runner.js`, `dispatchToolCall`). A call to a partner's facts
  network is one model call with no tool definitions: its instructions plus the request,
  and `check_partner.mjs` prints its size. In a test, a call to the guesthouse example's
  facts network sent about 1,500 tokens, and a call to its main network about 2,100
  tokens and loaded a bridge frame.

## Let other sites call this site

Do this for every site.

1. **Keep the bridge.** The build writes `bridge/action-bridge.html` and
   `bridge/agent-manifest.json` when the manifest has `actions`, and checks that
   `actions.bridge` is `"./bridge/action-bridge.html"`. Callers load that page in a
   hidden frame before they run the network. Without it they wait 10 seconds, then ask
   their visitor to open a popup, and the network never runs. The bridge's manifest lists
   no action module, so callers get none of this site's actions and none of its page code
   runs in their visitors' browsers (`runtime/action-transport.js`,
   `serveActionBridge`). Do not edit the `bridge/` folder.
2. **Keep `{peer_rules}`** in the front agent's instructions. Run on another site, the
   network has no `website_*` tools, and the rule makes it point to this site's page
   instead of guessing. The runtime then adds a note after it that says "Report missing
   integration explicitly" (`runtime/actions.js`, `actionContext`), so the rule says to
   ignore that. A caller of this site's main network learns little more than the front
   agent's first sentence, so name the kinds of things the site offers there (see
   "Writing instructions" in `network_design.md`).
3. **Host it.** Serve the files that "Static hosting" in `bundle_and_hosting.md` lists,
   with the headers it gives, the `bridge/` and `facts/` rules included; locally,
   `serve_site.mjs` does this. Use HTTPS in production (spec sections 3.2 and 3.3).
4. **Pick the model.** Give the network a small, widely available model. Callers on stock
   nsdeploy runtimes run this network on that model when their visitor picked none.
5. **Publish facts for callers.** Write `agent-facts.mjs` and mark the page parts it
   quotes ("Facts for callers"). The build writes `facts/`.

## Facts for callers

Called on another site, this site's main network has none of its site tools, so it can
only say what the site offers. So the build also writes a second, small network for other
agent sites: `facts/<network>_facts`, with one agent, no tools and no bridge. Its
instructions hold this site's public facts, with the date they last changed. A caller
names that URL, and one model call answers from the facts. This site's own page never
loads it, so its own model calls do not grow (`scripts/facts_network.mjs`).

1. **What goes in.** Only facts that are the same for every visitor: what the site
   offers, prices, times, rules and contact details. They come from two places in
   `agent-facts.mjs`, which you write from `templates/agent-facts.mjs`:
   - `PAGES` lists the pages whose marked parts the build quotes, word for word. Mark each
     part on its page with `data-agent-facts="<topic>"`, such as
     `<section id="pets" data-agent-facts="pets">`. A marked part holds only paragraphs,
     headings, lists, tables, links and emphasis. It carries no class or style, sits in no
     form, template, `noscript`, `details` or hidden element, and its topic is used once.
     The build refuses anything else and says why (`scripts/marked_text.mjs`). When the
     text sits in styled markup, mark a plain wrapper around it, or give the fact in
     `dataFacts()` instead.
   - `dataFacts()` returns topics of lines from the site's own page-free describers, such
     as a room or product list in the words its cards use ("Expose page-only facts" in
     `site_actions.md`). Import only site files that load without a page: never the page
     script, and no `node:` modules, `process`, `fetch` or file reads. The build runs the
     module in a separate Node process with no environment variables.
   - Never publish anything about one person or booking, anything a visitor wrote, live
     data such as free rooms, text a visitor cannot see, form labels and hints, keys or
     internal notes, words aimed at another model, or totals for one party. The full list
     is in `templates/agent-facts.mjs`. A booking step stated as a policy is fine, such as
     "choose After 9 pm as your arrival time when you book".
2. **The date.** "As of" is the day the facts last changed. A rebuild with no change keeps
   it, so `--check` passes on any later day. Set `CHECKED_ON` to the day you last checked
   the facts, and the date moves forward without a change. The facts network tells callers
   that facts for dates more than a year after "as of" may have changed. Nothing expires.
   So if the owner raises a price on the page and uploads it without a rebuild, callers
   still read the old price, with its old date, until the next rebuild.
3. **Hosting.** Keep the facts export in `linking.exports` (`templates/agent-manifest.json`).
   Serve the three files in `facts/` with CORS, as "Static hosting" in
   `bundle_and_hosting.md` says; under a subpath, add it to each path. Keep the network
   file in `facts/` next to its manifest: the checker fails a facts URL whose file is on
   another origin. When you remove the facts network, delete `facts/` and the export too.
   If the site already has a `facts/` folder of its own, ask the user: the build stops
   rather than write there.
4. **Keep it true.** Rebuild after any change to the data or a marked part. Run the build
   with `--check` before you upload: it fails when `facts/` is out of date. Run
   `tests/facts.test.mjs`, from `templates/tests/facts.test.mjs`, which checks what the
   facts say and that they hold nobody's details. After you upload, run
   `check_partner.mjs` on this site's facts URL with no `--origin`: it reads the live
   pages and data again and fails when they no longer match the facts.
5. **What the partner's host sees.** The three GETs, from the visitor's browser and
   address. Each carries the calling site's origin as `Origin` and, under the default
   referrer policy, as `Referer`. It never sees the request or a cookie.
6. **What can still go wrong.** The runtime sets no timeout on the three GETs, so a facts
   host that accepts the connection but never answers leaves the visitor's chat waiting
   until they reload, as any partner does ("Limits per visitor message" above).

## Call a partner site

Do this only when the user names a partner site that publishes an agent network.

1. **Check it.** If you know only the partner's site, read `networks[].name` in the
   `agent-manifest.json` next to its home page: the network URL is that folder, then the
   name.

   ```shell
   node SKILL_DIR/scripts/check_partner.mjs <partner network URL> --origin <this site's origin>
   ```

   It loads the partner's public files the way a caller does. It prints how the
   partner's front agent's instructions start, which is about all a caller learns from
   it, then what the partner's network can reach and the lines to add to this site. Read
   what it can reach before you add the partner, because the partner's instructions read
   every request.

   - If it reports an error, a call to that partner would fail: tell the user instead of
     adding it.
   - If the check says the partner publishes a facts network, use its facts URL in the
     steps below, and name only that URL: a facts network cannot call back into this site.
   - If the partner is not up yet, such as a site you are building at the same time, ask
     the user before you add it: the build checks only this site's side. Run the check
     again once the partner is up.
   - At the checkpoint, tell the user what the partner can answer from here ("Site
     tools" above), and ask whether they still want the call.
   - A partner on `localhost` or `127.0.0.1` works only on this machine. Before this site
     goes live, put the partner's https URL in `tools`, `link_labels` and
     `allowed_peers`, rebuild, and run the check on that URL. The tool name comes from
     the URL's whole path, such as `stay_partner_network` for
     `https://partner.example/stay/partner_network`, so change the "How to work" line to
     match.
2. **Declare it.**
   - Put the exact URL in the calling agent's `tools`.
   - Put its origin, with the port, in the manifest's `allowed_peers`, and keep
     `peer_policy.mode` `"closed"`. Change `peer_policy.note` to say that the site calls
     the partner sites in `allowed_peers` after the visitor agrees.
   - Add a top-level `link_labels` block to the `.hocon`, after `cruse` as in
     `templates/network.hocon`, keyed by the exact URL:

     ```hocon
     "link_labels": {
         "https://partner.example/partner_network": "Partner Name"
     },
     ```

   Write the label yourself: it is the name on the consent card. The calling model sees
   it too: the runtime describes the partner tool as "Hand off to the <label> network."
   (`runtime/runner.js`, `buildToolTable`). The checker suggests the partner's brand.
   Never use `link_slots` for a partner: an unbound slot makes the chat ask the visitor
   for a URL. Leave `linking.imports` empty: nsdeploy lists link slots there.
3. **Tell the agent.** Add a "How to work" line that names the tool and says when to call
   it and what to ask. The build and `check_partner.mjs` print the tool name, such as
   `partner_network` for `https://partner.example/partner_network`. A facts URL's tool
   name starts with `facts_`, such as `facts_partner_network_facts` for
   `https://partner.example/facts/partner_network_facts`. Under a folder, the name also
   carries the folder (step 1) and can be cut at 60 characters: copy it from the build's
   "Partner tools:" line. For a facts URL, the line asks with exact dates, and with what
   the partner's prices depend on, such as weekdays, party size and children's ages, as
   the template's TODO line shows. The build warns when it does not ask with exact dates.
   Keep the template's
   `partner_rules` string and its `{partner_rules}` line after the "How to work" lines; a
   site built before linking copies both from `templates/network.hocon`. In
   `partner_rules`, replace `website_<read_action>` with the read action whose result has
   the partner's link, so the agent can send the visitor there. If the page has no link
   to the partner's own page, add one and read its `href` in the read action ("Expose
   page-only facts" in `site_actions.md`): the agent has no other link to give, and the
   network URL is not a page.
4. **What goes in a request.** One or two short sentences. Ask a main URL only what the
   partner can answer from its instructions, such as what it offers and how to book. Give
   a facts URL exact dates, and what its prices and rules depend on, such as the weekdays,
   the party size and children's ages. Take weekdays from this site's own read when it
   gives them. Keep it under 140 characters: the visitor sees only that much on the card.
   Never names, emails, phone numbers or booking codes.
5. **What to promise visitors.** In `GREETING`, the assistant section and the sample
   queries, promise only what a partner can answer from here. For a main URL, that is what
   it offers, such as "I can ask <partner> what it offers" or "Is there a good place to
   eat nearby?". Do not promise anything behind its site tools, such as which rooms or
   dishes it has, free places or prices: write "what it offers", not "what rooms it has".
   For a facts URL, you may promise what its site publishes, with its date, such as its
   rooms or dishes, prices, times and rules. Never promise any partner's free rooms,
   places left or bookings.
6. **What comes back.** `{partner_rules}` tells the agent how to read it:

   | The tool result, or its `text`, starts with | It means |
   | --- | --- |
   | `The user declined to contact <host>.` | The visitor declined. Nothing was fetched. |
   | `Skipped <label>: ...` | Over a limit, or the network is already in the call chain. |
   | `Error from tool '<tool>': ...` | The partner could not be fetched, validated or allowed. `Failed to fetch` means the browser could not read its files: its server is down or unreachable, or it sends no CORS header. |
   | `Error from <host>: ...` | The partner's network failed while it ran. |
   | anything else | The partner's answer, as `{"cruse":1,"text":...}`. |

   A skip inside the partner's own run, such as the 90 s limit, comes back as
   `{"cruse":1,"text":"Skipped ..."}`, so the rule checks the text too. An empty `text`
   means the partner's agent used up its steps before it answered (`runtime/runner.js`,
   `runAgentManual`). The answer can also hold the partner's own forms. The runtime's
   note tells the calling agent to merge them into its own, so the rule says never to
   show them: a partner could otherwise ask this site's visitor for personal details.
7. **Content-Security-Policy.** If this site sends a Content-Security-Policy, allow each
   partner's origin in `connect-src` and `frame-src`.
8. **The README.** Add a short "Linked site" section:
   - the partner's network URL (its facts URL, when it has one), and for a partner served
     on this machine, the command that serves it on the other host name, and why (see "Two
     linked sites" below);
   - what the consent card shows, and that **Always allow** skips the card for every
     partner on that host until the page is reloaded;
   - what a request contains, and that the assistant is told never to put names, emails,
     phone numbers or booking codes in it, though the runtime does not filter it, so the
     visitor checks it on the card;
   - that the partner's network runs in this browser on the visitor's key, with none of
     the partner's site tools, and that a call costs more than the card's token estimate.
     A main URL cannot give live availability or prices. A facts URL answers from the
     partner's dated public facts, such as prices and rules, but not availability or
     bookings.
9. **Rebuild and check.** Run the build without `--check`, which writes the network file,
   then the checks in "Check it".

## Check it

- **The build.** Run it with `--check`, as in step 7 of `SKILL.md`. It fails on a
  missing or misplaced bridge, a partner URL the runtime would refuse, a partner or MCP
  origin missing from `allowed_peers`, a partner tool whose name another tool of the
  same agent already has, and a partner with no `link_labels` entry. It warns when
  instructions lack `{peer_rules}` or `{partner_rules}` or never name a partner tool,
  when either rule differs from `templates/network.hocon`, and on link slots or an open
  peer policy. For a partner on `localhost` or `127.0.0.1`, it prints what to replace
  before hosting. With `agent-facts.mjs`, it also writes `facts/`, and fails on a `TODO`
  left in `agent-facts.mjs`, on hidden or unclear page parts, on facts that differ from
  the pages and data (with `--check`), on old facts files in `facts/`, and on a `facts/`
  folder of the site's own. It warns when a facts URL's line does not ask with exact
  dates, when an agent that calls a partner lacks the template's first grounding line,
  and when an agent names both a partner's main URL and its facts URL.
- **The Node tests.** The template's tests check that:
  - the front agent keeps the peer and partner rules;
  - a partner's action never gets this page's dialog, and neither does a chat form
    that bundles one of this page's dialog actions with others;
  - the consent card gets focus while it waits, unless the visitor is typing in the
    page's own form, and then gives focus back to the chat.
- **The server.** `node SKILL_DIR/scripts/serve_site.mjs <out> --port 8080` sends the CORS
  header on the public files and never blocks framing. It binds to `127.0.0.1` unless you
  pass `--host`, and prints the URL to open. `--log <file>` adds one JSON line per
  request with the path, the status, the `Origin`, whether an `Authorization` header was
  sent and the cookie names. It never logs a key or a cookie value.
- **Callers.** To check that other agent sites can call this one, serve it, then run
  `node SKILL_DIR/scripts/check_partner.mjs <this site's network URL>` with no
  `--origin`. Use the URL that partners put in their `tools` for this site, such as
  `http://localhost:8081/<network B>` for site B in "Two linked sites" below. If no
  site names this one yet, use the URL the server printed, then the network name, such
  as `http://127.0.0.1:8080/<network>`. It loads this site's public files and its bridge
  the way any other site does, and prints the lines a calling site adds. With this
  site's own origin, the CORS check would be skipped. If this site publishes facts, run
  it on `<base>/facts/<network>_facts` too, and again after each upload: with no
  `--origin`, it also checks that the live pages and data still match the facts.
- **Two linked sites.** To try two linked sites on one machine, open them under different
  host names: serve one with `--open-as 127.0.0.1` and the other with
  `--open-as localhost`. On one host name, the runtime's key cookie reaches the other
  site. Both servers bind to `127.0.0.1`; `--open-as` changes only the URL they print.

  ```shell
  node SKILL_DIR/scripts/serve_site.mjs <site A> --port 8080 --open-as 127.0.0.1
  node SKILL_DIR/scripts/serve_site.mjs <site B> --port 8081 --open-as localhost
  ```

  Use the same host names in the partner URLs and in `allowed_peers`: site A calls
  `http://localhost:8081/<network B>`, and site B calls `http://127.0.0.1:8080/<network A>`.
- **The consent card without a key.** See "Check without a key" in
  `bundle_and_hosting.md`.
- **The live check.** With the user's own key, check that the card appears before anything
  is sent (the browser's Network panel, or the partner server's `--log` file), and that
  declining gives an honest answer. The build and the Node tests check the setup, not how
  a real model follows the peer and partner rules. Only the live check shows that. Three
  runtime messages around a partner call are expected:
  - While the card waits, the runtime's status line says "Contacting <label>…", though
    nothing has been sent (`runtime/turn-status.js`). `assistant.css` hides it until the
    visitor answers, and `site.js` names the card and moves focus to its title, so a
    screen reader reads it and a stray Enter answers nothing.
  - After an allowed call, the "website actions connected" note at the top of the chat
    says "Remote action bridge: No actions exposed to this caller" when opened, in place
    of the note that other actions run right away. The partner's bridge shares no
    actions (`runtime/index.js`).
  - A failed partner call shows as done, with a green dot, in the agents panel
    (`runtime/ui.js`). The chat answer still says that it failed.

## Update a site built before linking

1. Re-copy `runtime/`. Delete the old copy first, because `cp -R` into an existing folder
   puts the new copy inside it:

   ```shell
   rm -rf <out>/runtime
   cp -R SKILL_DIR/runtime <out>/runtime
   ```

2. Add `"bridge": "./bridge/action-bridge.html"` to `actions` in `agent-manifest.json`.
3. Add `peer_rules` from `templates/network.hocon` to `commondefs.replacement_strings`,
   and `{peer_rules}` to the end of the front agent's instructions, after
   `{cruse_rules}`. In each write action's "How to work" line, say to call it "only when
   the visitor asks", as `templates/network.hocon` does: `testActionsMatchManifest`
   checks it. Then check the instruction count the build prints.
4. Check the front agent's first sentence. It should name the kinds of things the site
   offers ("Writing instructions" in `network_design.md`): a caller learns little more
   than that.
5. Copy from the templates:
   - into the site's tests, from `templates/tests/agentified.test.mjs`: the rule checks in
     `testNetworkIsValid` and `testActionsMatchManifest`; the tests
     `testPartnerActionGetsRuntimeDialog`, `testBundledFormRunsNothing`,
     `testOtherBundlesGetRuntimeDialog`, `testConsentFocusesTheCardThenTheChat` and
     `testConsentLeavesFocusInThePage`, with their `test(...)` lines and the helpers they
     use (`runtimeReviews`, `recordRuntimeReview`, `shownCards`, `answerCard`,
     `keepAnswer`, `pendingCard`, `consentCard` and `outsideChat`). Also copy
     `templates/tests/stub_document.mjs` and `stub_element.mjs`, and pass the test's
     `BASE` to `StubDocument.fromHtml` as the template does;
   - into `site.js`, the `review()`, `consent()` and `focusConsentCard()` methods from
     `templates/site.js`, and the two lines in `start()` that set `defaultConsent` and
     `onConsent`;
   - into the stylesheet, any rules from `templates/assistant.css` that it lacks.
6. Rebuild, which writes `bridge/`, and run the tests:

   ```shell
   node SKILL_DIR/scripts/build_network.mjs <out>/<network>.hocon --manifest <out>/agent-manifest.json
   node --test "<out>/tests/*.test.mjs"
   ```

7. Serve it with `serve_site.mjs`, and check it as in "Callers" under "Check it". In the
   site's README, change the run command to match and add `bridge/` to the file list.

To have the site call a partner too, follow "Call a partner site".

## Update a site built before facts

1. Copy `partner_rules` and the first grounding line from `templates/network.hocon`. The
   build warns "partner_rules differs" until they match, and warns about the old
   grounding line once a partner is called.
2. For each partner, run `check_partner.mjs` on its main URL. When it says the partner
   publishes a facts network, put the facts URL in `tools` and `link_labels` in place of
   the main URL, and change the "How to work" line to the new tool name, asking with exact
   dates ("Call a partner site", steps 1, 3 and 4). Check the instruction count the build
   prints: the facts line is about 40 to 60 characters longer.
3. Write `agent-facts.mjs` from `templates/agent-facts.mjs`, mark the page parts it quotes
   ("Facts for callers"), and add the facts export to `linking.exports` in
   `agent-manifest.json`, from `templates/agent-manifest.json`. Show the user the marked
   parts and the `dataFacts()` lines, and ask them to confirm what is published.
4. Add the `facts/` lines from "Static hosting" in `bundle_and_hosting.md` to the host's
   headers; under a subpath, add it to each path.
5. Copy `templates/tests/facts.test.mjs` into the site's `tests/` and fill it in, and copy
   the new rule checks in `testNetworkIsValid` from `templates/tests/agentified.test.mjs`.
6. Rebuild, run the build with `--check` and the tests, serve the site and run
   `check_partner.mjs` on its facts URL with no `--origin` ("Check it").
7. In the README, change the "Linked site" section as step 8 of "Call a partner site"
   says, and add the facts URL as "The README" in `bundle_and_hosting.md` says.

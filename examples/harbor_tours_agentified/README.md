# Marrow Point Harbor Tours, agentified

A small tour company website with four trips, a trip finder, a basket, a
reservation form and "Manage my reservation", plus a Good to know page. It uses
plain HTML, CSS and JavaScript modules with no dependencies or build step.

This copy also has an assistant on the page. It runs in the visitor's browser,
uses the visitor's own LLM key, answers from the site's own data, and calls the
site's own functions to fill the basket, reserve and cancel. It can also ask
Tidewhistle Guesthouse, a linked agent website, what it offers.

The commands below assume this folder sits at `examples/harbor_tours_agentified`
in the agentic-web repository, next to `examples/guesthouse_agentified`, and that
you run them from the repository root:

```shell
node skills/agentify-website/scripts/serve_site.mjs examples/harbor_tours_agentified --port 8081 --open-as localhost
```

Open http://localhost:8081/. Port 8081 lets it run beside the guesthouse on
port 8080. The server sends the CORS header on the public agent files, so other
agent sites can call this one; `python3 -m http.server` does not. Use a local
server rather than opening `index.html` from disk: browsers don't run JavaScript
modules from `file://` pages.

## Try it

1. Browse the four trips: times, places, prices, ages, access and dogs.
2. Under **Find a trip**, choose a date from tomorrow and your tickets, then
   select **Show trips**.
3. Select **Add to basket** for up to 4 trips. Adding a trip again replaces its
   tickets, and **Remove** takes it out.
4. Add your details and select **Reserve my trips** to get a reservation code.
5. Under **Manage my reservation**, look up the code and last name, then
   cancel.

Other people's reservations fill some trips. Tomorrow's 10 am Seal Rocks Cruise
is full, and the 2 pm one has 2 places left. To try **Manage my reservation**
without reserving first, use:

- `HT-3MVK` / `Thorne`: tomorrow's 10 am Seal Rocks Cruise. You can cancel it
  today, which frees 4 places on that trip.
- `HT-K2HC` / `Osei`: today's 3 pm Harbor and Lighthouse Loop, which can't be
  cancelled online.
- `HT-T6FY` / `Lindqvist`: two trips, the next Twilight Sail and the next Sea
  Wall History Walk.

[policies.html](policies.html), "Good to know", covers tickets and ages,
booking and cancelling, the weather, prices and payment, the meeting point and
getting here, what to bring, accessibility and dogs.

Prices are in USD. Reservations stay in page memory: refreshing the page clears
new reservations and cancellations and restores the existing ones. Nothing is
reserved and no payment is collected. The page itself sends nothing to a
server, but the assistant sends the visitor's messages, and the page data it
reads, to the LLM provider the visitor picks.

## The assistant

Open **⚙ AI model settings** under the chat, paste your own
[Otari](https://otari.ai) API key and select **Save and start**. The site uses
hosted Otari (`https://api.otari.ai/api/v1`) with `alibaba/qwen-3.5-35b-a3b` by
default. For another provider, select it in the panel, which fills in its
provider URL and model, or enter both under **Advanced settings (optional)**; the
provider must allow browser CORS. On `localhost` and `127.0.0.1`, the runtime
also keeps saved setups, keys included, in a cookie that any local site can
read, so use a key with a low spending limit. When you are done, select
**Delete setup** under **Advanced settings (optional)**, then close the tab: the
tab keeps using the key until it is closed.

The assistant can:

- answer about the trips, prices, ages, dogs, access and the Good to know page;
- list the departures on a date for your party, with places left and prices;
- add trips to the basket and remove them, at once and without asking, as you
  could on the page;
- reserve the basket and cancel a reservation, each only after you confirm in a
  dialog that shows the trips, the total and until when you can cancel;
- look up a reservation by its code and last name;
- ask Tidewhistle Guesthouse what it offers, after you agree on a card.

It says plainly what the site can't do, such as online payment, changing a
reservation, cancelling one trip of several, charters, fishing trips, gift
vouchers, discount codes, pickups, confirmation emails or texts, and booking
rooms.

Sample questions:

- Which trips welcome dogs, and which have step-free boarding?
- What could 2 adults and a 3-year-old do next Saturday, and what would it cost?
- Put the 2 pm Seal Rocks Cruise two weeks from today in my basket for 2 adults
  and 1 child.
- Cancel reservation HT-3MVK under the last name Thorne.
- Where can we stay nearby?
- Can I buy a gift voucher or book a fishing trip with you?

### Its network URL

The network is `http://localhost:8081/marrow_point_harbor_tours` here: the
folder that holds `agent-manifest.json`, then the network name. Other agent
websites can run this network in their own visitors' browsers. They get none of
this site's tools, so their assistant says what this site offers and points to
this page for times, places and reservations.

## Linked site

The assistant asks Tidewhistle Guesthouse about rooms through its facts network at
`http://127.0.0.1:8080/facts/tidewhistle_guesthouse_facts`. Serve the guesthouse
from the repository root with:

```shell
node skills/agentify-website/scripts/serve_site.mjs examples/guesthouse_agentified --port 8080 --open-as 127.0.0.1
```

The two sites use different host names, `127.0.0.1` and `localhost`, because on
one host name the runtime's key cookie would reach the other site with its
requests.

Before anything is sent, a card in the chat asks you to allow the contact. It
names Tidewhistle Guesthouse, shows its host and the first 140 characters of the
request. A request is one or two short sentences with exact dates and weekdays,
the party size and children's ages, such as "Rooms for two adults, Friday 12 to
Sunday 14 June: what do they cost?". The assistant is told never to put names,
emails, phone numbers or booking codes in it, but the runtime does not filter
the request, so check it on the card. The guesthouse's facts network then runs
in this browser, on your key and model, as one model call with no tools. It
answers from the guesthouse's published facts, with their date: rooms, rates and
house policies. It cannot see which rooms are free or book one, so book rooms
with the guesthouse directly.

Other agent sites can call this site's facts network at
`http://localhost:8081/facts/marrow_point_harbor_tours_facts`. It answers from
the trips, times, prices and rules, with their date, and cannot see places left
or reserve. They can also call this network at
`http://localhost:8081/marrow_point_harbor_tours`, with none of this site's
functions.

The `127.0.0.1` address works only on this machine. Before hosting, put the
guesthouse's https facts URL in the `.hocon` file's `tools` and
`link_labels`, and its origin in `allowed_peers` in `agent-manifest.json`, then
build again.

## Build and test

From the repository root:

```shell
node skills/agentify-website/scripts/build_network.mjs examples/harbor_tours_agentified/marrow_point_harbor_tours.hocon --manifest examples/harbor_tours_agentified/agent-manifest.json
node skills/agentify-website/scripts/build_network.mjs examples/harbor_tours_agentified/marrow_point_harbor_tours.hocon --manifest examples/harbor_tours_agentified/agent-manifest.json --check
node --test "examples/harbor_tours_agentified/tests/*.test.mjs"
```

With both sites served, check the link both ways:

```shell
node skills/agentify-website/scripts/check_partner.mjs http://127.0.0.1:8080/facts/tidewhistle_guesthouse_facts --origin http://localhost:8081
node skills/agentify-website/scripts/check_partner.mjs http://localhost:8081/marrow_point_harbor_tours
node skills/agentify-website/scripts/check_partner.mjs http://localhost:8081/facts/marrow_point_harbor_tours_facts
```

The last check also compares the live pages and data with this site's facts, so
run it again after each upload.

The tests use the real runtime and page code with a scripted model. They call no
LLM provider.

## Hosting

Serve `agent-manifest.json`, `marrow_point_harbor_tours.network.json`,
`links.json`, `agent-mcp.json`, `.well-known/nsdeploy.json`,
`.well-known/nsdeploy-agent.json`, `facts/agent-manifest.json`,
`facts/marrow_point_harbor_tours_facts.network.json` and `facts/links.json` with
`Access-Control-Allow-Origin: *`, and never `agent-facts.mjs`. Serve
`runtime/sandbox-worker.js` with
`Content-Security-Policy: default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'`.
Do not block framing for `bridge/`: other agent sites load
`bridge/action-bridge.html` in a hidden frame. Use HTTPS. If the site sends a
Content-Security-Policy, allow the LLM router in `connect-src` and the
guesthouse's origin in `connect-src` and `frame-src`.

## Files

- `index.html`: trips and prices, the trip finder, the basket and reservation
  form, Manage my reservation, where to stay, and the assistant.
- `policies.html`: Good to know, in eight sections.
- `styles.css`: shared responsive styles, with the assistant's styles at the
  end, and no external fonts or assets.
- `favicon.svg`: the site icon.
- `js/app.js`: starts the page and keeps it in `App.page`.
- `js/tours-page.js`: renders the page and connects its forms and buttons to
  the operations. The assistant calls the same operations.
- `js/trip-book.js`: the reservations in memory and the operations.
- `js/trip-basket.js`: the basket.
- `js/trip-rules.js`: the booking rules and their messages.
- `js/fare-calculator.js`: itemized prices, money and plural text.
- `js/calendar.js`: date and time helpers, including the one place the site
  reads today's date.
- `js/tour-data.js`: tours, booking limits, harbor dues and existing
  reservations.
- `js/good-to-know.js`: reads the Good to know page for the assistant.
- `js/tour-facts.js`: words each tour's facts as its trip card does. It loads
  without a page, so the trip cards and `agent-facts.mjs` use the same words.
- `site.js`: boots the assistant and shows its confirmation dialogs.
- `site-actions.js`: the site's operations as the assistant's `website_*`
  tools.
- `marrow_point_harbor_tours.hocon`: the agent network's source.
- `marrow_point_harbor_tours.network.json`: built from the `.hocon`; do not
  edit it by hand.
- `agent-manifest.json`, `links.json`: the public files other agent sites read.
- `agent-mcp.json`, `.well-known/`: discovery files, built from the manifest.
- `bridge/`: the page other agent sites load in a hidden frame, built by the
  build script. It shares no actions.
- `agent-facts.mjs`: the public facts for other agent sites: the trips from
  `js/tour-facts.js`, and the page parts marked `data-agent-facts` in
  `index.html` and `policies.html`.
- `facts/`: the facts network other agent sites call, built from
  `agent-facts.mjs`. Do not edit it by hand.
- `runtime/`: the browser runtime, copied unchanged from the skill.
- `tests/`: Node tests for the network, the actions and the dialogs.

## How the code works

`TourData` holds the tours (id, name, boat or walk, vessel, length in minutes,
the days and times each runs, places per departure, adult and child prices in
integer cents, minimum age, whether dogs are welcome, highlights and access),
the harbor dues, the booking limits and the existing reservations, dated
relative to today.

A party is `{ adults, children, under4s }`, each a whole number. A trip is a
departure plus a party: `{ tourId, date, time, adults, children, under4s }`,
with the date as `"YYYY-MM-DD"` and the time as `"HH:MM"`, such as `"14:00"`. A
contact is `{ firstName, lastName, email, phone, notes }`. Places are adults
plus children: children under 4 go free and take no place.

`TripBook` runs the operations. Each one returns an object, and when the input
breaks a rule that object holds only `errors`, a message for each form field:

- `departures(date, party)` returns `{ departures }`: every departure on the
  date, sorted by time, each with `tourId`, `date`, `time`, `placesLeft`,
  `problem` (why the party doesn't fit, or `""`) and `quote` (`null` when there
  is a problem).
- `quote(trip)` returns `{ trip, quote }`: a copy of the trip and its price,
  `{ places, lines, total }`, line by line.
- `reserve(trips, contact)` returns `{ reservation }`, with 1 to 4 trips under
  one new code. It trims the contact details before it checks and stores them,
  and stores nothing unless every trip and detail is fine. `reserveErrors` runs
  the same checks without storing anything.
- `lookUp(code, lastName)` returns `{ reservation, cancelBy }`. `cancelBy` is
  the last day to cancel online, or `null` when it can't be cancelled.
- `cancel(code, lastName)` returns `{ reservation, cancelBy: null }`. It cancels
  every trip in the reservation, free of charge, and frees its places.
  `cancelErrors` runs the same checks without cancelling.

A reservation is `{ code, status, contact, trips, total }`. Its `status` is
"confirmed" or "cancelled", and each trip keeps its quote.

`TripBasket` holds up to 4 trips in page memory, in the order they were added:

- `add(trip)` checks and prices the trip with `quote`, adds it and returns
  `{ trip, replaced }`. A trip for a departure already in the basket replaces
  that one, in the same place.
- `remove(tourId, date, time)` takes a trip out and returns `{ removed }`.
- `trips()` lists copies of the trips, and `clear()` empties the basket.

`TripRules` holds the rules. A trip's date is a real date from tomorrow to 60
days ahead, on a day its tour runs, at one of its times. Ticket numbers are
whole numbers, with at least 1 ticket, an adult with any children, an adult for
each child under 4 and at most 8 places. A tour with a minimum age, the
Twilight Sail, takes no children under 4, and a trip needs enough places left.
A reservation needs a first and last name, a valid email, a mobile phone with
at least 7 digits, and notes of at most 300 characters.

`ToursPage` calls these operations from the page. After a reservation or a
cancellation, it runs the last search again and prices the basket again. Its
`addTrip`, `removeTrip`, `reserveTrips` and `cancelBooking` change the page and
return `{ ok: false, reason }` when the site refuses; the page's own buttons
and forms call them too, and only those handlers move focus or reset a form.
`getState`, `findDepartures`, `lookUpReservation` and `goodToKnow` only read.
A basket version counts basket changes, so a reservation refuses a basket the
visitor has not seen.

`Calendar.today()` is the only place the site reads the clock. To pin the date
in tests, set `Calendar.fixedToday` to a date such as `"2026-11-11"` before
creating a `TripBook`.

Online payment, changing a reservation, cancelling one trip of several,
same-day booking, groups of 9 or more, private charters, fishing trips, gift
vouchers, discount codes, hotel pickup, confirmation emails and texts, weather
alerts, durable storage and room bookings are not implemented. Replace the
in-memory reservations with a backend before taking real reservations.

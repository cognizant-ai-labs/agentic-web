# Tidewhistle Guesthouse, agentified

The Tidewhistle Guesthouse website with an assistant built into the page. The
site has rooms, an availability search, a booking form and "Manage my booking",
plus a page of house policies. The assistant runs in the visitor's browser,
uses the visitor's own LLM API key, answers from the site's real data and calls
the site's own functions to search, price, fill in the booking form, book and
cancel. It can also ask the Marrow Point Harbor Tours assistant about tours,
and other agent sites can call its network (see "Linked site"). It uses plain
HTML, CSS and JavaScript modules with no dependencies or build step. It was
made from `examples/guesthouse` with the agentify-website skill.

From the repository root, run:

```shell
node skills/agentify-website/scripts/serve_site.mjs examples/guesthouse_agentified --port 8080
```

Open http://127.0.0.1:8080/, the address it prints. The skill's server sends
the CORS header on the public files, so other agent sites can call this one.
Use the local server rather than opening `index.html` from disk: browsers
don't run JavaScript modules from `file://` pages.

## Try it

1. Browse the four rooms: beds, guest limits, rates, amenities, access and pets.
2. Under **Check availability**, choose check-in and check-out dates and the
   number of guests, then select **Search rooms** to see the free rooms and
   what each stay costs.
3. Select **Book the ...** on a result. The booking form takes the room, dates
   and guests. Change any of them or tick extras, and the itemized price
   updates.
4. Add your name, email, an optional phone number, your arrival time and any
   special requests, then select **Confirm booking** to get a confirmation code.
5. Under **Manage my booking**, enter the code and your last name to see the
   booking and what cancelling it today would cost, then cancel it.
6. Under **Ask Tidewhistle Guesthouse**, open **⚙ AI model settings**, paste
   your own [Otari](https://otari.ai) API key and select **Save and start**. The
   site uses hosted Otari (`https://api.otari.ai/api/v1`) with
   `alibaba/qwen-3.5-35b-a3b` by default. For another provider, select it in the
   panel, which fills in its provider URL and model. Then ask, for example,
   "Is any room free for two guests for three nights starting three weeks from
   today?" The browser asks you to confirm before the assistant books or
   cancels anything. On `127.0.0.1` the runtime also keeps the key in a cookie
   that other local sites can read, so use a key with a low spending limit.
   Afterwards, delete the saved setup and close the tab: the tab keeps using the
   key until it is closed.

Other guests' bookings fill some nights over the next 60 days. To try
**Manage my booking** without booking first, use code `TW-7KQ2` and last name
`Pell`. That stay starts today, so cancelling it costs the full room charge.

[policies.html](policies.html) covers check-in and check-out times, length of
stay, the cancellation policy, fees and payment, pets, quiet hours, children
and accessibility.

Prices are in USD. Bookings stay in page memory: refreshing the page clears new
bookings and cancellations and restores the existing ones. No payment is
collected and nothing is booked. The assistant sends your messages and the page
data it reads to the LLM provider you choose.

## Linked site

The assistant can ask the Marrow Point Harbor Tours facts network about boat
trips, seal watching and sea-wall walks, at
`http://localhost:8081/facts/marrow_point_harbor_tours_facts`. To try it, serve
the tour site too, from the repository root in a second terminal:

```shell
node skills/agentify-website/scripts/serve_site.mjs examples/harbor_tours_agentified --port 8081 --open-as localhost
```

Open the tour site at http://localhost:8081/, not 127.0.0.1. The two sites use
two host names on purpose. On `127.0.0.1` and `localhost`, the runtime keeps
saved keys in a cookie for the host name, on every port. On one host name, the
tour site would get that cookie, key included.

Then ask this site's assistant about a boat trip. Before anything is sent, a
card shows the tour site's name, its host and the first 140 characters of the
request, and asks you to agree. Treat the request as sent to the tour site: its
assistant reads it. This site's rules tell the assistant to give the tour site
exact dates with weekdays, the party size and children's ages, and never to put
in names, emails, phone numbers or booking codes. The runtime does not filter
the request, so check it on the card. **Always allow** skips the card, and that
check, for the tour site until you reload the page. After you agree, the tour
site's facts network runs in this browser, on your key and router, and costs
more than the card's token estimate. It answers from the tour site's published
facts, with their date: trips, times, prices and rules. It cannot see places
left or book, so it points to the tour site's page for those. If you decline, nothing is sent to the tour site, and the assistant
should say so and give the tour site's link from this page. It should do the
same when the tour site is not running.

Other agent sites can call this site's facts network at
`http://127.0.0.1:8080/facts/tidewhistle_guesthouse_facts`. It answers from
the rooms, rates and house policies, with their date, and cannot see
availability or bookings. It has no tools, so it cannot call back into the
calling site. They can also call this network at
`http://127.0.0.1:8080/tidewhistle_guesthouse`. It then runs in their
visitor's browser with none of this site's functions, and should point to this
page for availability and bookings. Their visitor also gets a card for the
tour site if this network asks it.

## Tests

From the repository root:

```shell
node --test "examples/guesthouse_agentified/tests/*.test.mjs"
```

The tests use the real runtime and page code with a scripted model, and call no
LLM provider. One test prints how many characters of system prompt and tool
definitions each model call sends. After changing
`tidewhistle_guesthouse.hocon`, `agent-manifest.json`, `agent-facts.mjs`, the
room data or a marked page part, rebuild the generated files with the skill's
`scripts/build_network.mjs` (see the comment at the top of the `.hocon` file).
`tests/facts.test.mjs` checks that the facts say what the data and pages say and
hold no guest's details.

In a browser, also look up `TW-7KQ2` / `Pell` and then `TW-7KQ2` / `Pel` in
**Manage my booking**, and run the read check in "Check without a key" in the
skill's `references/bundle_and_hosting.md` for `get_guesthouse_state`:
`managedBooking` must be null.

## Files

- `index.html`: rooms, availability search, booking form, manage booking and
  the assistant section.
- `policies.html`: house policies and fees.
- `styles.css`: shared responsive styles, with no external fonts or assets, and
  the assistant's styles at the end.
- `favicon.svg`: the site icon.
- `js/app.js`: starts the page and keeps it as `App.page`.
- `js/booking-page.js`: renders the page, connects its forms and buttons to the
  operations, and gives the assistant the same operations.
- `js/booking-facts.js`: rooms, prices and bookings as plain JSON, with the
  words, dates and amounts the page shows.
- `js/house-policies.js`: reads the policies from `policies.html` for the
  assistant.
- `js/reservation-book.js`: the bookings in memory and the booking operations.
- `js/stay-rules.js`: the booking rules and their messages.
- `js/price-calculator.js`: itemized prices.
- `js/calendar.js`: date helpers, including the one place the site reads
  today's date.
- `js/guesthouse-data.js`: rooms, extras, fees, cancellation tiers and existing
  bookings.
- `site.js`: boots the assistant and shows its confirmation dialog.
- `site-actions.js`: registers the operations the assistant can call.
- `tidewhistle_guesthouse.hocon`: the agent network's source.
- `tidewhistle_guesthouse.network.json`, `agent-mcp.json` and `.well-known/`:
  generated from the `.hocon` file and the manifest. Do not edit them by hand.
- `bridge/`: the page other agent sites load in a hidden frame before they run
  this network, with its own manifest, which shares none of this site's
  functions. The build writes it. Do not edit it by hand.
- `agent-facts.mjs`: the public facts for other agent sites: the rooms from
  `js/booking-facts.js`, and the page parts marked `data-agent-facts` in
  `index.html` and `policies.html`.
- `facts/`: the facts network other agent sites call, with its own manifest and
  `links.json`. The build writes it from `agent-facts.mjs`. Do not edit it by
  hand.
- `agent-manifest.json` and `links.json`: the public files that describe the
  network.
- `runtime/`: the browser runtime, copied unchanged from the skill.
- `tests/`: Node tests with a DOM stand-in and a scripted model.

`GuesthouseData` holds the rooms (id, name, beds, maximum guests, nightly and
weekend rates in integer cents, amenities, accessibility and whether dogs are
allowed), the extras, the cleaning fee, the tourist tax, the stay limits, the
arrival times guests can choose, the cancellation tiers and the existing
bookings, dated relative to today. A booking's arrival time must be one of
`ARRIVAL_TIMES`, word for word: "3 pm to 5 pm", "5 pm to 7 pm",
"7 pm to 9 pm" or "After 9 pm (self check-in)".

`ReservationBook` runs the operations. Each one returns an object, and when the
input breaks a rule that object holds `errors`, a message for each form field:

- `search(checkIn, checkOut, guests)` lists the free rooms with a price for
  each.
- `quote(stay)` prices a room, dates, guests and extras, line by line.
- `checkPlace(stay, guest)` checks a booking without placing it.
- `place(stay, guest)` runs `checkPlace`, then books the stay and returns it
  with a confirmation code.
- `lookUp(code, lastName)` finds a booking and what cancelling it today costs.
- `checkCancel(code, lastName, expectedFee)` checks a cancellation without
  making it.
- `cancel(code, lastName, expectedFee)` runs `checkCancel`, then cancels the
  booking and applies the cancellation policy. `expectedFee` is the fee in
  cents the guest was shown. The fee depends on today's date. If it is no
  longer `expectedFee`, `cancel` refuses and changes nothing.

A stay has a `roomId`, the `checkIn` and `checkOut` dates as `"YYYY-MM-DD"`,
`guests` as a whole number and `extras` as a list of extra ids, each listed
once. A guest has `firstName`, `lastName`, `email`, an optional `phone`,
`arrival` and optional `requests`. `place` trims the guest's details before it
checks and stores them, as the booking form does.

`StayRules` checks that check-in is not in the past, check-out is after
check-in, stays with a Saturday night are at least 2 nights, stays are at most
14 nights, guests fit the room and the email is valid. `ReservationBook` also
makes sure bookings for the same room don't overlap.

`BookingPage` calls these operations from the page. `chooseRoom(roomId)` and
`updateDraft()` keep the booking draft (room, dates, guests and extras) in step
with the booking form, and its price on screen. After a booking or a
cancellation, the page runs the last search again and re-prices the draft.
The assistant calls `readState()`, `searchRooms`, `quoteStay`, `fillDraft`,
`lookUpBooking`, `placeStay` and `cancelStay` on `App.page`, and the
confirmation dialog calls `checkBooking` and `checkCancel`. The page's own
forms and buttons use `placeStay` and `cancelStay` too. These return
`{ok: false, reason, field, errors}` when the site refuses, and change nothing.

`Calendar.today()` is the only place the site reads the clock. To pin the date
in tests, set `Calendar.fixedToday` to a date such as `"2026-11-10"` before
creating a `ReservationBook`.

Online payment, changing a booking, confirmation emails, durable storage,
airport pickup, gift cards and tour bookings are not implemented. Replace the
in-memory bookings with a backend before taking real bookings.

# Marrow Point Harbor Tours

A small tour company website with four trips, a trip finder, a basket, a
reservation form and "Manage my reservation", plus a Good to know page. It uses
plain HTML, CSS and JavaScript modules with no dependencies or build step.

From the repository root, run:

```shell
python3 -m http.server 8081 --directory ./examples/harbor_tours
```

Open http://127.0.0.1:8081/. Port 8081 lets it run beside the guesthouse on
port 8080. Use the local server rather than opening `index.html` from disk:
browsers don't run JavaScript modules from `file://` pages.

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
new reservations and cancellations and restores the existing ones. No data is
sent to a server, no payment is collected and nothing is reserved.

## Files

- `index.html`: trips and prices, the trip finder, the basket and reservation
  form, Manage my reservation and where to stay.
- `policies.html`: Good to know, in eight sections.
- `styles.css`: shared responsive styles, with no external fonts or assets.
- `favicon.svg`: the site icon.
- `js/app.js`: starts the page.
- `js/tours-page.js`: renders the page and connects its forms and buttons to
  the operations.
- `js/trip-book.js`: the reservations in memory and the operations.
- `js/trip-basket.js`: the basket.
- `js/trip-rules.js`: the booking rules and their messages.
- `js/fare-calculator.js`: itemized prices, money and plural text.
- `js/calendar.js`: date and time helpers, including the one place the site
  reads today's date.
- `js/tour-data.js`: tours, booking limits, harbor dues and existing
  reservations.

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
  and stores nothing unless every trip and detail is fine.
- `lookUp(code, lastName)` returns `{ reservation, cancelBy }`. `cancelBy` is
  the last day to cancel online, or `null` when it can't be cancelled.
- `cancel(code, lastName)` returns `{ reservation, cancelBy: null }`. It cancels
  every trip in the reservation, free of charge, and frees its places.

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
cancellation, it runs the last search again and prices the basket again.

`Calendar.today()` is the only place the site reads the clock. To pin the date
in tests, set `Calendar.fixedToday` to a date such as `"2026-11-11"` before
creating a `TripBook`.

Online payment, changing a reservation, cancelling one trip of several,
same-day booking, groups of 9 or more, private charters, fishing trips, gift
vouchers, discount codes, hotel pickup, confirmation emails and texts, weather
alerts, durable storage and room bookings are not implemented. Replace the
in-memory reservations with a backend before taking real reservations.

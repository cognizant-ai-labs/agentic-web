# Tidewhistle Guesthouse

A small guesthouse website with rooms, an availability search, a booking form
and "Manage my booking", plus a page of house policies. It uses plain HTML, CSS
and JavaScript modules with no dependencies or build step.

From the repository root, run:

```shell
python3 -m http.server 8080 --directory ./examples/guesthouse
```

Open http://127.0.0.1:8080/. Use the local server rather than opening
`index.html` from disk: browsers don't run JavaScript modules from `file://`
pages.

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

Other guests' bookings fill some nights over the next 60 days. To try
**Manage my booking** without booking first, use code `TW-7KQ2` and last name
`Pell`. That stay starts today, so cancelling it costs the full room charge.

[policies.html](policies.html) covers check-in and check-out times, length of
stay, the cancellation policy, fees and payment, pets, quiet hours, children
and accessibility.

Prices are in USD. Bookings stay in page memory: refreshing the page clears new
bookings and cancellations and restores the existing ones. No data is sent to a
server, no payment is collected and nothing is booked.

## Files

- `index.html`: rooms, availability search, booking form and manage booking.
- `policies.html`: house policies and fees.
- `styles.css`: shared responsive styles, with no external fonts or assets.
- `favicon.svg`: the site icon.
- `js/app.js`: starts the page.
- `js/booking-page.js`: renders the page and connects its forms and buttons to
  the operations.
- `js/reservation-book.js`: the bookings in memory and the booking operations.
- `js/stay-rules.js`: the booking rules and their messages.
- `js/price-calculator.js`: itemized prices.
- `js/calendar.js`: date helpers, including the one place the site reads
  today's date.
- `js/guesthouse-data.js`: rooms, extras, fees, cancellation tiers and existing
  bookings.

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
- `place(stay, guest)` books the stay and returns it with a confirmation code.
- `lookUp(code, lastName)` finds a booking and what cancelling it today costs.
- `cancel(code, lastName, expectedFee)` cancels a booking and applies the
  cancellation policy. `expectedFee` is the fee in cents the guest was shown.
  The fee depends on today's date. If it is no longer `expectedFee`, `cancel`
  refuses and changes nothing.

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

`Calendar.today()` is the only place the site reads the clock. To pin the date
in tests, set `Calendar.fixedToday` to a date such as `"2026-11-10"` before
creating a `ReservationBook`.

Online payment, changing a booking, confirmation emails, durable storage,
airport pickup, gift cards and tour bookings are not implemented. Replace the
in-memory bookings with a backend before taking real bookings.

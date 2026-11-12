import { BookingFacts } from "./booking-facts.js";
import { Calendar } from "./calendar.js";
import { GuesthouseData } from "./guesthouse-data.js";
import { PriceCalculator } from "./price-calculator.js";
import { ReservationBook } from "./reservation-book.js";

/**
 * Connects index.html to the reservation book. The page's forms and buttons
 * call these methods, which run an operation and show its result, any
 * validation messages and a short status announcement.
 *
 * The operations (searchRooms, quoteStay, fillDraft, placeStay, lookUpBooking
 * and cancelStay) are also what the assistant calls. They return plain JSON:
 * a refusal is {ok: false, reason, field, errors} and changes nothing. Focus
 * moves and form resets stay in the form and button handlers.
 *
 * Placing or cancelling a booking also runs the last search again and
 * re-prices the booking draft, so both match the current bookings.
 */
export class BookingPage {
  /** Page-only facts the assistant reads, by topic, with the id of the element that holds each. */
  static FACTS = {
    about: "about",
    demo: "demo-note",
    rooms: "rooms-note",
    payment: "payment-note",
    changes: "changes-note",
    tours: "tours-note",
    travel: "travel-note",
    contact: "contact",
    phoneHours: "phone-hours",
  };

  /**
   * Create the page controller.
   *
   * :param doc: the page's document
   * :param book: the reservation book that runs the operations
   */
  constructor(doc, book) {
    this.doc = doc;
    this.book = book;
    // The last valid search fills in the dates when a room is chosen.
    this.lastSearch = null;
    // The code of the booking in the confirmation box, if it is showing one.
    this.confirmedCode = null;
    // The code of the booking in the Manage my booking panel, if it is showing one.
    this.managedCode = null;
  }

  /**
   * Render the rooms and booking choices, then connect the forms.
   */
  start() {
    for (const input of this.doc.querySelectorAll('input[type="date"]')) input.min = Calendar.today();
    for (const room of GuesthouseData.ROOMS) {
      this.renderRoom(room);
      this.byId("book-roomId").append(new Option(`${room.name} (sleeps ${room.maxGuests})`, room.id));
    }
    for (const extra of GuesthouseData.EXTRAS) {
      const box = this.element("input");
      box.type = "checkbox";
      box.value = extra.id;
      const label = this.element("label", "", "check");
      label.append(box, ` ${BookingFacts.extraLabel(extra)}`);
      this.byId("book-extras").append(label);
    }
    for (const time of GuesthouseData.ARRIVAL_TIMES) this.byId("book-arrival").append(new Option(time, time));
    this.byId("search-form").addEventListener("submit", this.search.bind(this));
    this.byId("stay-fields").addEventListener("change", this.updateDraft.bind(this));
    this.byId("booking-form").addEventListener("submit", this.placeBooking.bind(this));
    this.byId("manage-form").addEventListener("submit", this.findBooking.bind(this));
    this.updateDraft();
  }

  /**
   * Add a card for a room with its beds, rates, amenities, access and pets.
   *
   * :param room: the room
   */
  renderRoom(room) {
    const amenities = this.element("ul", "", "amenities");
    for (const amenity of room.amenities) amenities.append(this.element("li", amenity));
    const card = this.element("article", "", "room");
    card.append(
      this.element("h3", room.name),
      this.element("p", `${room.beds}. Sleeps ${room.maxGuests}.`, "facts"),
      this.element("p", BookingFacts.rates(room)),
      amenities,
      this.element("p", room.accessibility, "note"),
      this.element("p", BookingFacts.pets(room), "note"),
      this.button(`Choose the ${room.name}`, this.chooseRoom.bind(this, room.id)),
    );
    this.byId("room-list").append(card);
  }

  /**
   * Read the page's data and state for the assistant: rooms, extras, house
   * terms, today's date, the page-only facts, the booking draft, the last
   * search, the latest booking made in this tab and the booking the Manage
   * my booking panel shows. It leaves out other guests' bookings.
   *
   * :return: the state as plain JSON
   */
  readState() {
    return {
      today: BookingFacts.day(Calendar.today()),
      rooms: BookingFacts.rooms(),
      extras: BookingFacts.extras(),
      terms: BookingFacts.terms(),
      pageFacts: this.pageFacts(),
      bookingForm: this.draftState(),
      lastSearch: this.searchState(),
      latestBooking: this.latestBooking(),
      managedBooking: this.managedBooking(),
    };
  }

  /**
   * Read the facts that only the page's HTML holds, such as contact details,
   * payment and tours, with each link's address.
   *
   * :return: the facts by topic, each with its text and links
   */
  pageFacts() {
    const facts = {};
    for (const [topic, id] of Object.entries(BookingPage.FACTS)) {
      facts[topic] = this.fact(this.byId(id));
    }
    return facts;
  }

  /**
   * Read one page element's text and the address of each link in it.
   *
   * :param element: the element
   * :return: the text and the links
   */
  fact(element) {
    const links = [];
    // textContent leaves out a link's address, so read each href too.
    for (const link of element.querySelectorAll("a")) {
      links.push({
        text: BookingFacts.plain(link.textContent),
        href: link.href,
      });
    }
    return {
      text: BookingFacts.plain(element.textContent),
      links: links,
    };
  }

  /**
   * Describe the stay in the booking form and its price, or what it still needs.
   *
   * :return: the draft's room, dates, guests, extras and total
   */
  draftState() {
    const draft = this.readDraft();
    const result = this.book.quote(draft);
    return {
      roomId: draft.roomId,
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      // The dates with weekdays, once the page can price the stay, as in the other results.
      dates: result.errors ? null : BookingFacts.dates(draft, result.quote.nights),
      guests: draft.guests,
      extras: draft.extras,
      total: result.errors ? null : PriceCalculator.money(result.quote.total),
      stillNeeds: result.errors ? Object.values(result.errors).join(" ") : "",
    };
  }

  /**
   * Describe the last valid search on the page, with its dates and weekdays.
   *
   * :return: the search's dates and guests, or null when there was none
   */
  searchState() {
    const stay = this.lastSearch;
    if (!stay) {
      return null;
    }
    return {
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      dates: BookingFacts.dates(stay, Calendar.daysBetween(stay.checkIn, stay.checkOut)),
      guests: stay.guests,
    };
  }

  /**
   * Describe the booking in the confirmation box, which was made in this tab.
   *
   * :return: the booking, or null when the box is empty
   */
  latestBooking() {
    for (const booking of this.book.bookings) {
      if (booking.code === this.confirmedCode) {
        return BookingFacts.booking(booking);
      }
    }
    return null;
  }

  /**
   * Describe the booking the Manage my booking panel shows, with the note
   * under it. The visitor looked it up with its code and last name.
   *
   * :return: the booking, its last name and its note, or null when the panel
   *   shows none
   */
  managedBooking() {
    for (const booking of this.book.bookings) {
      if (booking.code === this.managedCode) {
        return {
          booking: BookingFacts.booking(booking),
          // The look-up and the cancellation need the last name on its own.
          lastName: booking.guest.lastName,
          note: BookingFacts.bookingNote(booking, ReservationBook.cancellationTerms(booking)),
        };
      }
    }
    return null;
  }

  /**
   * Search availability with the search form and list the free rooms.
   *
   * :param event: the form's submit event
   */
  search(event) {
    event.preventDefault();
    const stay = {
      checkIn: this.value("search-checkIn"),
      checkOut: this.value("search-checkOut"),
      guests: Number(this.value("search-guests")),
    };
    const result = this.listRooms(stay);
    if (this.showErrors("search", result.errors)) return;
    this.announce(`${PriceCalculator.count(result.rooms.length, "room")} free for those dates.`);
  }

  /**
   * List the rooms that are free for a stay, each with its price and a button
   * to book it. A valid stay becomes the last search.
   *
   * :param stay: check-in, check-out and guests
   * :return: the reservation book's search result
   */
  listRooms(stay) {
    const result = this.book.search(stay.checkIn, stay.checkOut, stay.guests);
    const list = this.byId("search-results");
    list.replaceChildren();
    this.lastSearch = result.errors ? null : stay;
    if (result.errors) return result;
    for (const match of result.rooms) {
      const item = this.element("li", "", "result");
      item.append(this.element("h3", match.room.name), this.element("p", BookingFacts.searchPrice(match.quote)));
      item.append(this.button(`Book the ${match.room.name}`, this.chooseRoom.bind(this, match.room.id)));
      list.append(item);
    }
    if (result.rooms.length === 0) {
      list.append(this.element("li", "No rooms are free for those dates. Try other dates, or call us on 555-0147."));
    }
    return result;
  }

  /**
   * Check which rooms are free for a stay and what each costs, without
   * changing the page's search results.
   *
   * :param stay: check-in, check-out and guests
   * :return: the free rooms with their prices, or a refusal
   */
  searchRooms(stay) {
    const result = this.book.search(stay.checkIn, stay.checkOut, stay.guests);
    if (result.errors) {
      return BookingPage.refusal(result.errors);
    }
    const rooms = [];
    for (const match of result.rooms) {
      rooms.push({
        roomId: match.room.id,
        room: match.room.name,
        sleeps: match.room.maxGuests,
        price: BookingFacts.searchPrice(match.quote),
      });
    }
    return {
      ok: true,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      dates: BookingFacts.dates(stay, Calendar.daysBetween(stay.checkIn, stay.checkOut)),
      guests: stay.guests,
      freeRooms: rooms,
    };
  }

  /**
   * Price a stay in one room with extras, line by line, without changing the
   * page's booking form.
   *
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :return: the priced stay, or a refusal
   */
  quoteStay(stay) {
    const draft = BookingPage.stayOf(stay);
    const result = this.book.quote(draft);
    if (result.errors) {
      return BookingPage.refusal(result.errors);
    }
    return Object.assign({ ok: true }, BookingFacts.pricedStay(draft, result.quote));
  }

  /**
   * Bring the search results and the booking price up to date after a
   * booking is placed or cancelled.
   */
  refreshAvailability() {
    if (this.lastSearch) this.listRooms(this.lastSearch);
    this.updateDraft();
  }

  /**
   * Put a room in the booking draft, with the dates and guests of the last
   * search if there was one.
   *
   * :param roomId: the room to book
   */
  chooseRoom(roomId) {
    const room = GuesthouseData.findById(GuesthouseData.ROOMS, roomId);
    if (!room) return;
    this.byId("book-roomId").value = room.id;
    if (this.lastSearch) {
      this.byId("book-checkIn").value = this.lastSearch.checkIn;
      this.byId("book-checkOut").value = this.lastSearch.checkOut;
      this.byId("book-guests").value = String(this.lastSearch.guests);
    }
    this.updateDraft();
    this.byId("book-roomId").focus();
    this.announce(`${room.name} chosen. Check your dates, guests and extras.`);
  }

  /**
   * Put a whole stay in the booking form and show its price, as if the guest
   * had filled in the stay fields, leaving the guest's own details alone. A
   * stay that breaks a rule is refused, and the form keeps what it had.
   *
   * :param stay: room id, check-in, check-out, guests and extra ids
   * :return: the booking form's new stay and price, or a refusal
   */
  fillDraft(stay) {
    const draft = BookingPage.stayOf(stay);
    const result = this.book.quote(draft);
    if (result.errors) {
      return BookingPage.refusal(result.errors);
    }
    this.byId("book-roomId").value = draft.roomId;
    this.byId("book-checkIn").value = draft.checkIn;
    this.byId("book-checkOut").value = draft.checkOut;
    this.byId("book-guests").value = String(draft.guests);
    for (const box of this.byId("book-extras").querySelectorAll("input")) {
      box.checked = draft.extras.includes(box.value);
    }
    this.updateDraft();
    return {
      ok: true,
      bookingForm: this.draftState(),
    };
  }

  /**
   * Read the booking draft from the booking form.
   *
   * :return: room id, check-in, check-out, guests and extra ids
   */
  readDraft() {
    const extras = [];
    for (const box of this.byId("book-extras").querySelectorAll("input:checked")) extras.push(box.value);
    return {
      roomId: this.value("book-roomId"),
      checkIn: this.value("book-checkIn"),
      checkOut: this.value("book-checkOut"),
      guests: Number(this.value("book-guests")),
      extras: extras,
    };
  }

  /**
   * Price the booking draft after each change, or say what it still needs.
   */
  updateDraft() {
    const result = this.book.quote(this.readDraft());
    const box = this.byId("quote");
    this.showErrors("book", null);
    if (result.errors) {
      box.replaceChildren(this.element("p", `To see your price: ${Object.values(result.errors).join(" ")}`));
      return;
    }
    const rows = [];
    for (const line of result.quote.lines) rows.push([line.label, line.detail, PriceCalculator.money(line.amount)]);
    rows.push(["Total", "Pay at the guesthouse", PriceCalculator.money(result.quote.total)]);
    const table = this.element("table");
    for (const cells of rows) {
      const row = table.insertRow();
      for (const text of cells) row.insertCell().textContent = text;
    }
    box.replaceChildren(this.element("h3", "Your price"), table);
    this.announce(`Your stay costs ${PriceCalculator.money(result.quote.total)}.`);
  }

  /**
   * Place the booking from the draft and the guest's details, then show the
   * confirmation code.
   *
   * :param event: the form's submit event
   */
  placeBooking(event) {
    event.preventDefault();
    const request = Object.assign(this.readDraft(), {
      firstName: this.value("book-firstName"),
      lastName: this.value("book-lastName"),
      email: this.value("book-email"),
      phone: this.value("book-phone"),
      arrival: this.value("book-arrival"),
      requests: this.value("book-requests"),
    });
    const receipt = this.placeStay(request);
    if (!receipt.ok) {
      this.showErrors("book", receipt.errors);
      return;
    }
    // Clear the form for the next booking, then price the empty draft again.
    this.byId("booking-form").reset();
    this.updateDraft();
    this.byId("confirmation").focus();
  }

  /**
   * Check a booking without placing it: every rule, a free room and the
   * guest's details. Changes nothing.
   *
   * :param request: room id, check-in, check-out, guests, extra ids and the guest's details
   * :return: the priced stay, the guest's details as they would be stored and
   *   what cancelling would cost today once it is booked, or a refusal
   */
  checkBooking(request) {
    const result = this.book.checkPlace(BookingPage.stayOf(request), BookingPage.guestOf(request));
    if (result.errors) {
      return BookingPage.refusal(result.errors);
    }
    // Apply the cancellation policy to the booking place() would store, without its code.
    const booking = ReservationBook.record(null, result.stay, result.guest);
    return {
      ok: true,
      stay: BookingFacts.pricedStay(result.stay, result.quote),
      guest: BookingFacts.guest(result.guest),
      cancellation: BookingFacts.cancellation(ReservationBook.cancellationTerms(booking)),
    };
  }

  /**
   * Place a booking, show its confirmation code and update the search
   * results and the booking price. Nothing is charged.
   *
   * :param request: room id, check-in, check-out, guests, extra ids and the guest's details
   * :return: the new booking, or a refusal
   */
  placeStay(request) {
    const result = this.book.place(BookingPage.stayOf(request), BookingPage.guestOf(request));
    if (result.errors) {
      return BookingPage.refusal(result.errors);
    }
    this.showConfirmation(result.booking);
    // The room is taken now, so the search results must stop offering it.
    this.refreshAvailability();
    this.announce(`Booking confirmed. Your confirmation code is ${result.booking.code}.`);
    return {
      ok: true,
      booking: BookingFacts.booking(result.booking),
    };
  }

  /**
   * Show a new booking and its code in the confirmation box.
   *
   * :param booking: the booking
   */
  showConfirmation(booking) {
    const confirmation = this.byId("confirmation");
    confirmation.replaceChildren(
      this.element("h3", `Booked! Your confirmation code is ${booking.code}.`),
      this.summary(booking),
      this.element("p", "Nothing has been charged. Keep your code to look up or cancel your booking."),
    );
    confirmation.hidden = false;
    this.confirmedCode = booking.code;
  }

  /**
   * Look up the booking named in the manage form.
   *
   * :param event: the form's submit event
   */
  findBooking(event) {
    event.preventDefault();
    const code = this.value("manage-code");
    const lastName = this.value("manage-lastName");
    this.showBooking(this.book.lookUp(code, lastName), code, lastName);
  }

  /**
   * Find a booking by code and last name, without changing the page's
   * Manage my booking panel.
   *
   * :param code: the confirmation code
   * :param lastName: the last name on the booking
   * :return: the booking, the page's note on cancelling it and today's fee, or a refusal
   */
  lookUpBooking(code, lastName) {
    const result = this.book.lookUp(code, lastName);
    if (result.errors) {
      return BookingPage.refusal(result.errors);
    }
    return {
      ok: true,
      booking: BookingFacts.booking(result.booking),
      note: BookingFacts.bookingNote(result.booking, result.cancellation),
      cancellation: BookingFacts.cancellation(result.cancellation),
    };
  }

  /**
   * Cancel a booking that was looked up, and show the fee.
   *
   * :param code: the confirmation code
   * :param lastName: the last name on the booking
   * :param expectedFee: the fee in cents that the booking panel showed
   */
  cancelBooking(code, lastName, expectedFee) {
    const receipt = this.cancelStay(code, lastName, expectedFee);
    if (!receipt.ok) {
      this.showBooking({ errors: receipt.errors }, code, lastName);
      return;
    }
    // The cancel button is gone, so move focus to the updated booking.
    this.byId("manage-result").focus();
  }

  /**
   * Check a cancellation without making it. Changes nothing.
   *
   * :param code: the confirmation code
   * :param lastName: the last name on the booking
   * :param expectedFee: the fee in cents the guest was shown
   * :return: the booking and today's fee, or a refusal
   */
  checkCancel(code, lastName, expectedFee) {
    const result = this.book.checkCancel(code, lastName, expectedFee);
    if (result.errors) {
      return BookingPage.refusal(result.errors);
    }
    return {
      ok: true,
      booking: BookingFacts.booking(result.booking),
      cancellation: BookingFacts.cancellation(result.cancellation),
    };
  }

  /**
   * Cancel a booking under the cancellation policy, then update the search
   * results, the booking price, the confirmation box and the booking panel.
   *
   * :param code: the confirmation code
   * :param lastName: the last name on the booking
   * :param expectedFee: the fee in cents the guest was shown
   * :return: the cancelled booking and the page's note on its fee, or a refusal
   */
  cancelStay(code, lastName, expectedFee) {
    const result = this.book.cancel(code, lastName, expectedFee);
    if (result.errors) {
      return BookingPage.refusal(result.errors);
    }
    // The room is free again. Update the other panels first, so the
    // cancellation is the last thing announced.
    this.refreshAvailability();
    if (result.booking.code === this.confirmedCode) {
      this.hideConfirmation();
    }
    this.showBooking(result, code, lastName);
    return {
      ok: true,
      booking: BookingFacts.booking(result.booking),
      note: BookingFacts.bookingNote(result.booking, result.cancellation),
    };
  }

  /**
   * Clear and hide the confirmation box after its booking is cancelled.
   */
  hideConfirmation() {
    const confirmation = this.byId("confirmation");
    confirmation.replaceChildren();
    confirmation.hidden = true;
    this.confirmedCode = null;
  }

  /**
   * Show a looked-up or cancelled booking with its cancellation terms, and a
   * cancel button while it can be cancelled online.
   *
   * :param result: the result of lookUp or cancel
   * :param code: the confirmation code the guest entered
   * :param lastName: the last name the guest entered
   */
  showBooking(result, code, lastName) {
    const box = this.byId("manage-result");
    box.replaceChildren();
    this.managedCode = null;
    if (this.showErrors("manage", result.errors)) return;
    const booking = result.booking;
    const terms = result.cancellation;
    const note = BookingFacts.bookingNote(booking, terms);
    box.append(this.element("h3", `Booking ${booking.code}: ${booking.status}`), this.summary(booking));
    box.append(this.element("p", note));
    if (booking.status === "confirmed" && terms) {
      // Pass the fee shown here, so the button never charges a different one.
      box.append(this.button("Cancel this booking", this.cancelBooking.bind(this, code, lastName, terms.fee)));
    }
    this.managedCode = booking.code;
    this.announce(`Booking ${booking.code} is ${booking.status}. ${note}`);
  }

  /**
   * Describe a booking: guest, room, dates, guests, extras and total.
   *
   * :param booking: the booking
   * :return: a description list
   */
  summary(booking) {
    const list = this.element("dl", "", "summary");
    for (const pair of BookingFacts.summaryRows(booking.stay, booking.guest, booking.quote)) {
      list.append(this.element("dt", pair[0]), this.element("dd", pair[1]));
    }
    return list;
  }

  /**
   * Turn the reservation book's errors into a refusal the assistant can read:
   * every message in reason, the first field in field, and the messages by
   * field, so a form can still show each one.
   *
   * :param errors: messages by field name
   * :return: the refusal
   */
  static refusal(errors) {
    return {
      ok: false,
      reason: Object.values(errors).join(" "),
      field: Object.keys(errors)[0],
      errors: Object.assign({}, errors),
    };
  }

  /**
   * Take the stay out of a booking request, with no extras when it has none.
   * The extras go in the booking form's order, so a stay is stored the same
   * way whatever order they came in.
   *
   * :param request: the request, with roomId, checkIn, checkOut, guests and extras
   * :return: the stay
   */
  static stayOf(request) {
    return {
      roomId: request.roomId,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      guests: request.guests,
      extras: request.extras === undefined ? [] : BookingPage.extrasInFormOrder(request.extras),
    };
  }

  /**
   * Put extra ids in the order the booking form lists the extras, as its
   * ticked boxes give them. Ids we don't offer, and repeats, stay in, so the
   * rules still refuse them.
   *
   * :param extras: the extra ids, or a value that isn't a list
   * :return: the ids in the form's order, or the value as it was
   */
  static extrasInFormOrder(extras) {
    // Keep a value that isn't a list as it is, so the rules can reject it.
    if (!Array.isArray(extras)) {
      return extras;
    }
    const ordered = [];
    for (const extra of GuesthouseData.EXTRAS) {
      for (const id of extras) {
        if (id === extra.id) {
          ordered.push(id);
        }
      }
    }
    for (const id of extras) {
      if (GuesthouseData.findById(GuesthouseData.EXTRAS, id) === null) {
        ordered.push(id);
      }
    }
    return ordered;
  }

  /**
   * Take the guest's details out of a booking request.
   *
   * :param request: the request, with firstName, lastName, email, phone, arrival and requests
   * :return: the guest's details
   */
  static guestOf(request) {
    return {
      firstName: request.firstName,
      lastName: request.lastName,
      email: request.email,
      phone: request.phone,
      arrival: request.arrival,
      requests: request.requests,
    };
  }

  /**
   * Show validation messages under their fields, replacing earlier ones.
   *
   * :param prefix: the id prefix of the form's fields, such as "book"
   * :param errors: messages by field name, or null when there are none
   * :return: true when there were messages to show
   */
  showErrors(prefix, errors) {
    for (const old of this.doc.querySelectorAll(`.field-error[id^="${prefix}-"]`)) {
      old.previousElementSibling.removeAttribute("aria-invalid");
      old.previousElementSibling.removeAttribute("aria-describedby");
      old.remove();
    }
    const names = errors ? Object.keys(errors) : [];
    for (const name of names) {
      const field = this.byId(`${prefix}-${name}`);
      const message = this.element("p", errors[name], "field-error");
      message.id = `${prefix}-${name}-error`;
      field.after(message);
      field.setAttribute("aria-describedby", message.id);
      // A fieldset can't be marked invalid, so only mark form controls.
      if (field.matches("input, select, textarea")) field.setAttribute("aria-invalid", "true");
    }
    if (names.length === 0) return false;
    // Focus the first field with a message, in page order.
    this.doc.querySelector(`.field-error[id^="${prefix}-"]`).previousElementSibling.focus();
    this.announce(`Please check the form. ${Object.values(errors).join(" ")}`);
    return true;
  }

  /**
   * Make a button that calls a handler when clicked.
   *
   * :param text: the button's label
   * :param handler: the bound method to call
   * :return: the button
   */
  button(text, handler) {
    const button = this.element("button", text);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  }

  /**
   * Make an element. Text goes in textContent, so guest input is never read as HTML.
   *
   * :param tag: the tag name
   * :param text: the text, or an empty string
   * :param className: the class name, if any
   * :return: the element
   */
  element(tag, text, className) {
    const node = this.doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /**
   * Find an element by its id.
   *
   * :param id: the id
   * :return: the element
   */
  byId(id) {
    return this.doc.getElementById(id);
  }

  /**
   * Read a form field's value without surrounding spaces.
   *
   * :param id: the field's id
   * :return: the trimmed value
   */
  value(id) {
    return this.byId(id).value.trim();
  }

  /**
   * Announce a message in the page's live status region.
   *
   * :param message: the message
   */
  announce(message) {
    this.byId("status").textContent = message;
  }
}

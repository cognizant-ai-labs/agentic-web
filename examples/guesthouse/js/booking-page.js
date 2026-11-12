import { Calendar } from "./calendar.js";
import { GuesthouseData } from "./guesthouse-data.js";
import { PriceCalculator } from "./price-calculator.js";

/**
 * Connects index.html to the reservation book. The page's forms and buttons
 * call these methods, which run an operation and show its result, any
 * validation messages and a short status announcement.
 *
 * Placing or cancelling a booking also runs the last search again and
 * re-prices the booking draft, so both match the current bookings.
 */
export class BookingPage {
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
      label.append(box, ` ${extra.name}, ${PriceCalculator.money(extra.price)} per ${extra.per}`);
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
    const rates = `${PriceCalculator.money(room.nightlyRate)} a night, `
      + `${PriceCalculator.money(room.weekendRate)} on Friday and Saturday nights`;
    const card = this.element("article", "", "room");
    card.append(
      this.element("h3", room.name),
      this.element("p", `${room.beds}. Sleeps ${room.maxGuests}.`, "facts"),
      this.element("p", rates),
      amenities,
      this.element("p", room.accessibility, "note"),
      this.element("p", room.petFriendly ? "Dogs welcome." : "No pets, but assistance dogs are welcome.", "note"),
      this.button(`Choose the ${room.name}`, this.chooseRoom.bind(this, room.id)),
    );
    this.byId("room-list").append(card);
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
      const price = `${PriceCalculator.count(match.quote.nights, "night")}: `
        + `${PriceCalculator.money(match.quote.total)} with the cleaning fee and tourist tax`;
      const item = this.element("li", "", "result");
      item.append(this.element("h3", match.room.name), this.element("p", price));
      item.append(this.button(`Book the ${match.room.name}`, this.chooseRoom.bind(this, match.room.id)));
      list.append(item);
    }
    if (result.rooms.length === 0) {
      list.append(this.element("li", "No rooms are free for those dates. Try other dates, or call us on 555-0147."));
    }
    return result;
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
    const guest = {
      firstName: this.value("book-firstName"),
      lastName: this.value("book-lastName"),
      email: this.value("book-email"),
      phone: this.value("book-phone"),
      arrival: this.value("book-arrival"),
      requests: this.value("book-requests"),
    };
    const result = this.book.place(this.readDraft(), guest);
    if (this.showErrors("book", result.errors)) return;
    const confirmation = this.byId("confirmation");
    confirmation.replaceChildren(
      this.element("h3", `Booked! Your confirmation code is ${result.booking.code}.`),
      this.summary(result.booking),
      this.element("p", "Nothing has been charged. Keep your code to look up or cancel your booking."),
    );
    confirmation.hidden = false;
    this.confirmedCode = result.booking.code;
    this.byId("booking-form").reset();
    // The room is taken now, so the search results must stop offering it.
    this.refreshAvailability();
    confirmation.focus();
    this.announce(`Booking confirmed. Your confirmation code is ${result.booking.code}.`);
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
   * Cancel a booking that was looked up, and show the fee.
   *
   * :param code: the confirmation code
   * :param lastName: the last name on the booking
   * :param expectedFee: the fee in cents that the booking panel showed
   */
  cancelBooking(code, lastName, expectedFee) {
    const result = this.book.cancel(code, lastName, expectedFee);
    if (!result.errors) {
      // The room is free again. Update the other panels first, so the
      // cancellation is the last thing announced.
      this.refreshAvailability();
      if (result.booking.code === this.confirmedCode) this.hideConfirmation();
    }
    this.showBooking(result, code, lastName);
    // The cancel button is gone, so move focus to the updated booking.
    if (!result.errors) this.byId("manage-result").focus();
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
    if (this.showErrors("manage", result.errors)) return;
    const booking = result.booking;
    const terms = result.cancellation;
    const fee = booking.cancellationFee;
    let note = "This stay has started, so it can't be cancelled online. Please talk to us at the guesthouse.";
    if (booking.status === "cancelled") {
      note = fee > 0
        ? `Cancelled. We'll email you an invoice for the ${PriceCalculator.money(fee)} cancellation fee.`
        : "Cancelled free of charge.";
    } else if (terms) {
      note = `If you cancel today: ${terms.fee > 0 ? PriceCalculator.money(terms.fee) : "no charge"} (${terms.rule}).`;
    }
    box.append(this.element("h3", `Booking ${booking.code}: ${booking.status}`), this.summary(booking));
    box.append(this.element("p", note));
    if (booking.status === "confirmed" && terms) {
      // Pass the fee shown here, so the button never charges a different one.
      box.append(this.button("Cancel this booking", this.cancelBooking.bind(this, code, lastName, terms.fee)));
    }
    this.announce(`Booking ${booking.code} is ${booking.status}. ${note}`);
  }

  /**
   * Describe a booking: guest, room, dates, guests, extras and total.
   *
   * :param booking: the booking
   * :return: a description list
   */
  summary(booking) {
    const stay = booking.stay;
    const extras = [];
    for (const id of stay.extras) extras.push(GuesthouseData.findById(GuesthouseData.EXTRAS, id).name);
    const nights = PriceCalculator.count(booking.quote.nights, "night");
    const rows = [
      ["Guest", `${booking.guest.firstName} ${booking.guest.lastName}`],
      ["Room", GuesthouseData.findById(GuesthouseData.ROOMS, stay.roomId).name],
      ["Dates", `${Calendar.format(stay.checkIn)} to ${Calendar.format(stay.checkOut)} (${nights})`],
      ["Guests", String(stay.guests)],
      ["Extras", extras.join(", ") || "None"],
      ["Total", `${PriceCalculator.money(booking.quote.total)}, paid at the guesthouse`],
    ];
    const list = this.element("dl", "", "summary");
    for (const pair of rows) list.append(this.element("dt", pair[0]), this.element("dd", pair[1]));
    return list;
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

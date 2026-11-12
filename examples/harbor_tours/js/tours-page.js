import { Calendar } from "./calendar.js";
import { FareCalculator } from "./fare-calculator.js";
import { TourData } from "./tour-data.js";
import { TripBook } from "./trip-book.js";

/**
 * Connects index.html to the trip book and the basket. The page's forms and
 * buttons call these methods, which run an operation and show its result,
 * any validation messages and a short status announcement.
 *
 * Reserving or cancelling also runs the last search again and prices the
 * basket again, so both show the places left now.
 */
export class ToursPage {
  /**
   * Create the page controller.
   *
   * :param doc: the page's document
   * :param book: the trip book that runs the operations
   * :param basket: the basket of trips to reserve
   */
  constructor(doc, book, basket) {
    this.doc = doc;
    this.book = book;
    this.basket = basket;
    // The last valid search, run again after a reservation or a cancellation.
    this.lastSearch = null;
    // The code of the reservation in the confirmation box, if it is showing one.
    this.confirmedCode = null;
  }

  /**
   * Render the tours and the basket, fill the tickets and connect the forms.
   */
  start() {
    const date = this.byId("find-date");
    date.min = Calendar.addDays(Calendar.today(), 1);
    date.max = Calendar.addDays(Calendar.today(), TourData.BOOK_AHEAD_DAYS);
    for (const id of ["find-adults", "find-children", "find-under4s"]) {
      // Adults start at 2. Making that the default too lets a form reset return to it.
      const chosen = id === "find-adults" ? 2 : 0;
      for (let count = 0; count <= TourData.MAX_PLACES; count += 1) {
        this.byId(id).append(new Option(String(count), String(count), count === chosen, count === chosen));
      }
    }
    for (const tour of TourData.TOURS) this.renderTour(tour);
    this.byId("find-form").addEventListener("submit", this.search.bind(this));
    this.byId("reserve-form").addEventListener("submit", this.reserve.bind(this));
    this.byId("manage-form").addEventListener("submit", this.findReservation.bind(this));
    this.renderBasket();
  }

  /**
   * Add a card for a tour, with its times, prices, access, ages and dogs.
   *
   * :param tour: the tour
   */
  renderTour(tour) {
    const highlights = this.element("ul", "", "highlights");
    for (const highlight of tour.highlights) highlights.append(this.element("li", highlight));
    const travel = tour.vessel ? `on the ${tour.vessel}` : "on foot";
    // A tour with a minimum age takes no children under 4, so it has no free tickets.
    const under4s = tour.minAge > 0 ? "" : ", under 4s free";
    const prices = `Adults ${FareCalculator.money(tour.adultPrice)}, `
      + `children ${FareCalculator.money(tour.childPrice)}${under4s}.`;
    const dogs = tour.dogsWelcome ? "Dogs on a lead welcome." : "No dogs, but assistance dogs are welcome.";
    const card = this.element("article", "", "tour");
    card.append(
      this.element("h3", tour.name),
      this.element("p", `${tour.minutes} minutes ${travel}. ${tour.places} places.`, "facts"),
      this.element("p", `Runs ${Calendar.describeDays(tour.days)} at ${Calendar.describeTimes(tour.times)}.`),
      this.element("p", prices),
      highlights,
      this.element("p", tour.access, "note"),
      this.element("p", tour.minAge > 0 ? `Ages ${tour.minAge} and over.` : "All ages.", "note"),
      this.element("p", dogs, "note"),
    );
    this.byId("tour-list").append(card);
  }

  /**
   * Search the departures with the find form and list them.
   *
   * :param event: the form's submit event
   */
  search(event) {
    event.preventDefault();
    const search = {
      date: this.value("find-date"),
      party: {
        adults: Number(this.value("find-adults")),
        children: Number(this.value("find-children")),
        under4s: Number(this.value("find-under4s")),
      },
    };
    const result = this.listDepartures(search);
    if (this.showErrors("find", result.errors)) return;
    this.announce(`${FareCalculator.count(result.departures.length, "trip")} on ${Calendar.format(search.date)}.`);
  }

  /**
   * List the departures on a date. A valid search becomes the last search.
   *
   * :param search: the date and the party
   * :return: the trip book's departures result
   */
  listDepartures(search) {
    const result = this.book.departures(search.date, search.party);
    const list = this.byId("departure-list");
    list.replaceChildren();
    this.lastSearch = result.errors ? null : search;
    if (result.errors) return result;
    for (const departure of result.departures) {
      const tour = TourData.findById(TourData.TOURS, departure.tourId);
      const left = departure.placesLeft > 0 ? `${FareCalculator.count(departure.placesLeft, "place")} left.` : "Full.";
      const item = this.element("li", "", "result");
      item.append(
        this.element("h3", `${Calendar.formatTime(departure.time)} · ${tour.name}`),
        this.element("p", `${tour.minutes} minutes. ${left}`, "facts"),
      );
      if (departure.problem) {
        item.append(this.element("p", departure.problem, "note"));
      } else {
        // The departure gives the tour, date and time, and the search gives the tickets.
        const trip = TripBook.copyTrip(Object.assign({}, departure, search.party));
        const price = `${FareCalculator.partyText(trip)}: ${FareCalculator.money(departure.quote.total)}`;
        item.append(this.element("p", price), this.button("Add to basket", this.addToBasket.bind(this, trip)));
      }
      list.append(item);
    }
    return result;
  }

  /**
   * Put a trip in the basket, replacing one for the same departure.
   *
   * :param trip: tourId, date, time, adults, children and under4s
   */
  addToBasket(trip) {
    const result = this.basket.add(trip);
    // Show every refusal under the basket. On success this clears an old message.
    const errors = result.errors ? { basket: Object.values(result.errors).join(" ") } : null;
    if (this.showErrors("reserve", errors)) return;
    this.renderBasket();
    this.announce(`${result.replaced ? "Updated" : "Added"}: ${TripBook.label(result.trip)}.`);
  }

  /**
   * Take a trip out of the basket.
   *
   * :param tourId: the tour
   * :param date: the date as "YYYY-MM-DD"
   * :param time: the time as "HH:MM"
   */
  removeFromBasket(tourId, date, time) {
    const result = this.basket.remove(tourId, date, time);
    if (this.showErrors("reserve", result.errors)) return;
    this.renderBasket();
    // The Remove button is gone, so move focus to the basket.
    this.byId("reserve-basket").focus();
    this.announce(`Removed: ${TripBook.label(result.removed)}.`);
  }

  /**
   * Show the basket's trips, each priced again, and the total.
   */
  renderBasket() {
    const list = this.byId("reserve-basket");
    list.replaceChildren();
    const trips = this.basket.trips();
    let total = 0;
    for (const trip of trips) {
      const item = this.element("li");
      item.append(this.element("h3", TripBook.label(trip)));
      // Price each trip again, as the places left or today's date may have changed.
      const result = this.book.quote(trip);
      if (result.errors) {
        item.append(this.element("p", Object.values(result.errors).join(" "), "note"));
      } else {
        total += result.quote.total;
        const lines = [];
        for (const line of result.quote.lines) {
          // A free line already says "free", so it needs no amount.
          const amount = line.amount > 0 ? ` = ${FareCalculator.money(line.amount)}` : "";
          lines.push(`${line.label}: ${line.detail}${amount}`);
        }
        item.append(
          this.element("p", `${FareCalculator.partyText(trip)}: ${FareCalculator.money(result.quote.total)}`),
          this.element("p", lines.join("; "), "note"),
        );
      }
      const remove = this.button("Remove", this.removeFromBasket.bind(this, trip.tourId, trip.date, trip.time));
      remove.className = "secondary";
      item.append(remove);
      list.append(item);
    }
    if (trips.length === 0) list.append(this.element("li", "Your basket is empty. Find a trip and add it here."));
    const totalLine = this.byId("basket-total");
    totalLine.textContent = `Total: ${FareCalculator.money(total)}, paid at the ticket hut`;
    totalLine.hidden = trips.length === 0;
  }

  /**
   * Update the departures and basket after a reservation or cancellation.
   */
  refresh() {
    if (this.lastSearch) this.listDepartures(this.lastSearch);
    this.renderBasket();
  }

  /**
   * Reserve the basket's trips with the visitor's details and show the code.
   *
   * :param event: the form's submit event
   */
  reserve(event) {
    event.preventDefault();
    const contact = {
      firstName: this.value("reserve-firstName"),
      lastName: this.value("reserve-lastName"),
      email: this.value("reserve-email"),
      phone: this.value("reserve-phone"),
      notes: this.value("reserve-notes"),
    };
    const result = this.book.reserve(this.basket.trips(), contact);
    if (this.showErrors("reserve", result.errors)) return;
    const code = result.reservation.code;
    const confirmation = this.byId("confirmation");
    confirmation.replaceChildren(
      this.element("h3", `Reserved! Your reservation code is ${code}.`),
      this.summary(result.reservation),
      this.element("p", "Nothing has been charged. Keep your code to look up or cancel your reservation."),
    );
    confirmation.hidden = false;
    this.confirmedCode = code;
    this.basket.clear();
    this.byId("reserve-form").reset();
    // The places are taken now, so the departures must show fewer left.
    this.refresh();
    confirmation.focus();
    this.announce(`Reservation confirmed. Your reservation code is ${code}.`);
  }

  /**
   * Look up the reservation named in the manage form.
   *
   * :param event: the form's submit event
   */
  findReservation(event) {
    event.preventDefault();
    const code = this.value("manage-code");
    const lastName = this.value("manage-lastName");
    this.showReservation(this.book.lookUp(code, lastName), code, lastName);
  }

  /**
   * Cancel a reservation that was looked up.
   *
   * :param code: the reservation code
   * :param lastName: the last name on the reservation
   */
  cancelReservation(code, lastName) {
    const result = this.book.cancel(code, lastName);
    if (!result.errors) {
      // The places are free again. Update the other panels first, so the
      // cancellation is the last thing announced.
      this.refresh();
      if (result.reservation.code === this.confirmedCode) this.hideConfirmation();
    }
    this.showReservation(result, code, lastName);
    // The cancel button is gone, so move focus to the updated reservation.
    if (!result.errors) this.byId("manage-result").focus();
  }

  /**
   * Clear and hide the confirmation box after its reservation is cancelled.
   */
  hideConfirmation() {
    const confirmation = this.byId("confirmation");
    confirmation.replaceChildren();
    confirmation.hidden = true;
    this.confirmedCode = null;
  }

  /**
   * Show a looked-up or cancelled reservation, with a cancel button if allowed.
   *
   * :param result: the result of lookUp or cancel
   * :param code: the reservation code the visitor entered
   * :param lastName: the last name the visitor entered
   */
  showReservation(result, code, lastName) {
    const box = this.byId("manage-result");
    box.replaceChildren();
    if (this.showErrors("manage", result.errors)) return;
    const reservation = result.reservation;
    let note = TripBook.TOO_LATE_TO_CANCEL;
    if (reservation.status === "cancelled") {
      note = "Cancelled. There is nothing to pay.";
    } else if (result.cancelBy) {
      note = `You can cancel online until the end of ${Calendar.format(result.cancelBy)}. Cancelling is free.`;
    }
    box.append(this.element("h3", `Reservation ${reservation.code}: ${reservation.status}`), this.summary(reservation));
    box.append(this.element("p", note));
    if (reservation.status === "confirmed" && result.cancelBy) {
      box.append(this.button("Cancel this reservation", this.cancelReservation.bind(this, code, lastName)));
    }
    this.announce(`Reservation ${reservation.code} is ${reservation.status}. ${note}`);
  }

  /**
   * Describe a reservation's name, trips and total, without contact details.
   *
   * :param reservation: the reservation
   * :return: a description list
   */
  summary(reservation) {
    const rows = [["Name", `${reservation.contact.firstName} ${reservation.contact.lastName}`]];
    for (let index = 0; index < reservation.trips.length; index += 1) {
      const trip = reservation.trips[index];
      const price = FareCalculator.money(trip.quote.total);
      rows.push([`Trip ${index + 1}`, `${TripBook.label(trip)}: ${FareCalculator.partyText(trip)}, ${price}`]);
    }
    rows.push(["Total", `${FareCalculator.money(reservation.total)}, paid at the ticket hut`]);
    const list = this.element("dl", "", "summary");
    for (const pair of rows) list.append(this.element("dt", pair[0]), this.element("dd", pair[1]));
    return list;
  }

  /**
   * Show validation messages under their fields, replacing earlier ones.
   *
   * :param prefix: the id prefix of the form's fields, such as "reserve"
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
      // A fieldset or list can't be marked invalid, so only mark form controls.
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
   * Make an element. Text goes in textContent, so visitor input is never read as HTML.
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

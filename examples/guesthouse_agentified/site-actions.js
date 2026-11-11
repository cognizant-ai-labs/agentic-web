// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Each action wraps an operation of the running booking page (App.page) or the house
// policies reader. The business rules stay in js/reservation-book.js and js/stay-rules.js.
// Operations return {ok: false, reason, field, errors} when they refuse input, before
// changing anything. A throw is reported as "unknown".
// js/app.js is imported by the same URL that index.html uses, so there is one page state.
import { App } from "./js/app.js";
import { GuesthouseData } from "./js/guesthouse-data.js";
import { HousePolicies } from "./js/house-policies.js";

/**
 * Describes the guesthouse's operations as actions the agents can call.
 *
 * Each action wraps a function the page already uses, so the assistant and the manual
 * UI share one set of rules. The runtime validates arguments against inputSchema before
 * execute runs, and asks the visitor to confirm "irreversible" actions first.
 */
class SiteActions {
  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.readStateAction());
    actions.register(SiteActions.readPoliciesAction());
    actions.register(SiteActions.searchRoomsAction());
    actions.register(SiteActions.quoteStayAction());
    actions.register(SiteActions.fillBookingFormAction());
    actions.register(SiteActions.lookUpBookingAction());
    actions.register(SiteActions.placeBookingAction());
    actions.register(SiteActions.cancelBookingAction());
  }

  /**
   * List the ids of one of the site's catalogs, for an enum.
   *
   * :param list: GuesthouseData.ROOMS or GuesthouseData.EXTRAS.
   * :return: The ids.
   */
  static ids(list) {
    const ids = [];
    for (const item of list) {
      ids.push(item.id);
    }
    return ids;
  }

  /**
   * Describe a date argument.
   *
   * :param description: What the date is.
   * :return: The schema.
   */
  static dateField(description) {
    return {
      type: "string",
      format: "date",
      description: description,
    };
  }

  /**
   * Describe the guest count. The bound is looser than the site's, so the site's own
   * message explains a count that no room fits.
   *
   * :return: The schema.
   */
  static guestsField() {
    return {
      type: "integer",
      minimum: 0,
      maximum: 20,
      description: "Number of guests the visitor gave, counted as the house policies say.",
    };
  }

  /**
   * Describe a room id, limited to the real rooms.
   *
   * :return: The schema.
   */
  static roomField() {
    return {
      type: "string",
      enum: SiteActions.ids(GuesthouseData.ROOMS),
      description: "Room id from website_get_guesthouse_state.",
    };
  }

  /**
   * Describe a list of extra ids, limited to the real extras. The site refuses one listed twice.
   *
   * :return: The schema.
   */
  static extrasField() {
    return {
      type: "array",
      maxItems: 10,
      items: {
        type: "string",
        enum: SiteActions.ids(GuesthouseData.EXTRAS),
      },
      description: "Extra ids from website_get_guesthouse_state, each once. Leave out for none.",
    };
  }

  /**
   * Describe a stay in one room: room, dates, guests and extras.
   *
   * :return: The schema's properties.
   */
  static stayProperties() {
    return {
      roomId: SiteActions.roomField(),
      checkIn: SiteActions.dateField("Check-in date the visitor wants, YYYY-MM-DD."),
      checkOut: SiteActions.dateField("Check-out date the visitor wants, YYYY-MM-DD."),
      guests: SiteActions.guestsField(),
      extras: SiteActions.extrasField(),
    };
  }

  /**
   * Describe the read action that returns the site's data and the page's state.
   *
   * :return: The action definition.
   */
  static readStateAction() {
    return {
      name: "get_guesthouse_state",
      description: "Read the rooms (beds, guest limit, rates, amenities, access, pets), extras, fees, stay limits, arrival times, cancellation fees, today's date, the home page's facts (contact, payment, changing a booking, tours, getting here, demo note) and the page's state: the stay in the booking form with its total, the last search on the page, the latest booking made in this tab and the booking Manage my booking shows. It does not show other guests' bookings or which rooms are free.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.readState,
    };
  }

  /**
   * Return a fresh copy of the page state.
   *
   * :return: The page state as plain JSON data.
   */
  static readState() {
    return App.page.readState();
  }

  /**
   * Describe the read action that returns the house policies page.
   *
   * :return: The action definition.
   */
  static readPoliciesAction() {
    return {
      name: "get_house_policies",
      description: "Read the house policies page: check-in and check-out, length of stay, cancellation and changes, fees and payment, pets, quiet hours, children and who counts as a guest, and accessibility. Returns each section's text, table rows and links.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.readPolicies,
    };
  }

  /**
   * Read the policies page, which the visitor can also open from the menu.
   *
   * :return: The page's sections.
   * :raises Error: When the page cannot be loaded; the runtime then reports "unknown".
   */
  static readPolicies() {
    return HousePolicies.read();
  }

  /**
   * Describe the availability search, which reads and changes nothing.
   *
   * :return: The action definition.
   */
  static searchRoomsAction() {
    return {
      name: "search_rooms",
      description: "Find the rooms that are free for a stay and fit the guests, each with its price for the nights, cleaning fee and tourist tax, without extras. Changes nothing on the page. Returns ok false with the site's reason when the dates or guests break a booking rule.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["checkIn", "checkOut", "guests"],
        properties: {
          checkIn: SiteActions.dateField("Check-in date the visitor wants, YYYY-MM-DD."),
          checkOut: SiteActions.dateField("Check-out date the visitor wants, YYYY-MM-DD."),
          guests: SiteActions.guestsField(),
        },
      },
      execute: SiteActions.searchRooms,
    };
  }

  /**
   * Search through the site's own availability check.
   *
   * :param args: The validated arguments with checkIn, checkOut and guests.
   * :return: The free rooms with prices, or ok false with a reason.
   */
  static searchRooms(args) {
    return App.page.searchRooms(args);
  }

  /**
   * Describe the price quote for one room, which reads and changes nothing.
   *
   * :return: The action definition.
   */
  static quoteStayAction() {
    return {
      name: "quote_stay",
      description: "Price a stay in one room with extras, line by line, after checking the booking rules and that the room is free. Changes nothing on the page. Returns ok false with the site's reason otherwise.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["roomId", "checkIn", "checkOut", "guests"],
        properties: SiteActions.stayProperties(),
      },
      execute: SiteActions.quoteStay,
    };
  }

  /**
   * Price a stay through the site's own quote.
   *
   * :param args: The validated stay.
   * :return: The priced stay, or ok false with a reason.
   */
  static quoteStay(args) {
    return App.page.quoteStay(args);
  }

  /**
   * Describe a reversible write the agent may run without a confirmation dialog.
   *
   * :return: The action definition.
   */
  static fillBookingFormAction() {
    return {
      name: "fill_booking_form",
      description: "Put a stay (room, dates, guests and extras) in the booking form on the page and show its price there, so the visitor can finish the booking on the page. Replaces the stay already in the form, but not the visitor's name or contact details. It does not book. Returns the form's new stay and total, or ok false with the site's reason, changing nothing.",
      // "write" runs immediately. The visitor can change or clear the form on the page.
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["roomId", "checkIn", "checkOut", "guests"],
        properties: SiteActions.stayProperties(),
      },
      execute: SiteActions.fillBookingForm,
    };
  }

  /**
   * Fill the booking form through the page's own draft function.
   *
   * :param args: The validated stay.
   * :return: The booking form's new stay and total, or ok false with a reason.
   */
  static fillBookingForm(args) {
    return App.page.fillDraft(args);
  }

  /**
   * Describe the booking look-up, which reads and changes nothing.
   *
   * :return: The action definition.
   */
  static lookUpBookingAction() {
    return {
      name: "look_up_booking",
      description: "Find a booking by its confirmation code and the last name on it, as Manage my booking does. Returns the booking, its status, the page's note and what cancelling it today costs (cancellation.feeCents), or ok false when no booking matches. Changes nothing on the page.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["code", "lastName"],
        properties: {
          code: {
            type: "string",
            maxLength: 12,
            description: "Confirmation code the visitor gave, such as TW-XXXX.",
          },
          lastName: {
            type: "string",
            maxLength: 60,
            description: "The last name on the booking, as the visitor gave it.",
          },
        },
      },
      execute: SiteActions.lookUpBooking,
    };
  }

  /**
   * Look up a booking through the site's own check of code and last name.
   *
   * :param args: The validated arguments with code and lastName.
   * :return: The booking and today's cancellation fee, or ok false with a reason.
   */
  static lookUpBooking(args) {
    return App.page.lookUpBooking(args.code, args.lastName);
  }

  /**
   * Describe the booking, which the visitor must confirm.
   *
   * :return: The action definition.
   */
  static placeBookingAction() {
    const properties = SiteActions.stayProperties();
    properties.firstName = {
      type: "string",
      minLength: 1,
      maxLength: 60,
      description: "The first name the visitor gave.",
    };
    properties.lastName = {
      type: "string",
      minLength: 1,
      maxLength: 60,
      description: "The last name the visitor gave.",
    };
    properties.email = {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "The email the visitor gave.",
    };
    properties.phone = {
      type: "string",
      maxLength: 20,
      description: "The phone number the visitor gave. Optional.",
    };
    properties.arrival = {
      type: "string",
      enum: GuesthouseData.ARRIVAL_TIMES.slice(),
      description: "When the visitor will arrive. Ask them; never choose for them.",
    };
    properties.requests = {
      type: "string",
      maxLength: 600,
      description: "Special requests the visitor gave. Optional. The house policies say what belongs here.",
    };
    return {
      name: "place_booking",
      description: "Book a stay. The browser asks the visitor to confirm first. Nothing is paid online: guests pay at the guesthouse. Returns the booking with its confirmation code.",
      // "irreversible" makes the runtime open a confirmation dialog before execute runs.
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["roomId", "checkIn", "checkOut", "guests", "firstName", "lastName", "email", "arrival"],
        properties: properties,
      },
      execute: SiteActions.placeBooking,
    };
  }

  /**
   * Book through the same function the page's own booking form uses.
   *
   * :param args: The validated, visitor-confirmed arguments.
   * :return: The booking with its code, or {ok: false, reason} when the site refuses it.
   * :raises Error: Only on an unexpected failure; the runtime then reports "unknown".
   */
  static placeBooking(args) {
    return App.page.placeStay(args);
  }

  /**
   * Describe the cancellation, which the visitor must confirm.
   *
   * :return: The action definition.
   */
  static cancelBookingAction() {
    return {
      name: "cancel_booking",
      description: "Cancel a booking under the cancellation policy. The site refuses if today's fee differs from expectedFeeCents. The browser asks the visitor to confirm first. Returns the cancelled booking and the page's note on its fee.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["code", "lastName", "expectedFeeCents"],
        properties: {
          code: {
            type: "string",
            minLength: 1,
            maxLength: 12,
            description: "Confirmation code the visitor gave.",
          },
          lastName: {
            type: "string",
            minLength: 1,
            maxLength: 60,
            description: "The last name on the booking, as the visitor gave it.",
          },
          expectedFeeCents: {
            type: "integer",
            minimum: 0,
            maximum: 10000000,
            description: "cancellation.feeCents from website_look_up_booking in this turn.",
          },
        },
      },
      execute: SiteActions.cancelBooking,
    };
  }

  /**
   * Cancel through the same function the page's own cancel button uses.
   *
   * :param args: The validated, visitor-confirmed arguments.
   * :return: The cancelled booking, or {ok: false, reason} when the site refuses it.
   * :raises Error: Only on an unexpected failure; the runtime then reports "unknown".
   */
  static cancelBooking(args) {
    return App.page.cancelStay(args.code, args.lastName, args.expectedFeeCents);
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;

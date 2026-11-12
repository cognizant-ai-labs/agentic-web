// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Each action wraps an operation of the page object that js/app.js keeps in App.page,
// so the assistant and the page's own buttons and forms follow one set of rules.
// Operations return {ok: false, reason, field} when they refuse input, before changing
// anything, and throw only on unexpected failures. A throw is reported as "unknown".
// This module imports js/app.js by the same URL index.html loads it from, so both use
// the same page state.
import { App } from "./js/app.js";

/**
 * Describes the site's operations as actions the agents can call.
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
    actions.register(SiteActions.goodToKnowAction());
    actions.register(SiteActions.findDeparturesAction());
    actions.register(SiteActions.addTripAction());
    actions.register(SiteActions.removeTripAction());
    actions.register(SiteActions.reserveAction());
    actions.register(SiteActions.lookUpAction());
    actions.register(SiteActions.cancelAction());
  }

  /**
   * Describe the read action that returns the page's data and current state.
   *
   * :return: The action definition.
   */
  static readStateAction() {
    return {
      name: "get_tours_state",
      description: "Read the tours (days, times, prices, ages, dogs, access), today and the next days with weekdays, the basket with its version and total, what the page's panels show, and page facts such as payment, booking, contact and where to stay, with links. Changes nothing.",
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
    return App.page.getState();
  }

  /**
   * Describe the read action that returns the Good to know page.
   *
   * :return: The action definition.
   */
  static goodToKnowAction() {
    return {
      name: "get_good_to_know",
      description: "Read the Good to know page: tickets and ages, booking and cancelling, weather, prices and payment, the meeting point and getting here, what to bring, accessibility and dogs. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.readGoodToKnow,
    };
  }

  /**
   * Read the Good to know page through the page object.
   *
   * :return: A promise of the page's sections.
   */
  static readGoodToKnow() {
    return App.page.goodToKnow();
  }

  /**
   * Give the ticket arguments every party-based action takes.
   *
   * :return: The adults, children and under4s schemas.
   */
  static ticketProperties() {
    return {
      adults: {
        type: "integer",
        minimum: 0,
        maximum: 50,
        description: "Adult tickets (16 and over), from the visitor.",
      },
      children: {
        type: "integer",
        minimum: 0,
        maximum: 50,
        description: "Child tickets (4 to 15), from the visitor.",
      },
      under4s: {
        type: "integer",
        minimum: 0,
        maximum: 50,
        description: "Free tickets for children under 4, from the visitor. They take no place.",
      },
    };
  }

  /**
   * Describe the read action that lists the departures on a date for a party.
   *
   * :return: The action definition.
   */
  static findDeparturesAction() {
    const properties = SiteActions.ticketProperties();
    properties.date = {
      type: "string",
      format: "date",
      description: "Trip date as YYYY-MM-DD, worked out from today in website_get_tours_state.",
    };
    return {
      name: "find_departures",
      description: "List every departure on a date for a party: places left, the party's price, or the problem if it does not fit, and the trip's age limit. The site does not check children's ages against an age limit. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["date", "adults", "children", "under4s"],
        properties: properties,
      },
      execute: SiteActions.findDepartures,
    };
  }

  /**
   * List the departures through the page's own trip book.
   *
   * :param args: The validated date and tickets.
   * :return: The departures, or ok false with the site's reason.
   */
  static findDepartures(args) {
    return App.page.findDepartures(args);
  }

  /**
   * Give the arguments that name one departure.
   *
   * :return: The tourId, date and time schemas.
   */
  static departureProperties() {
    return {
      tourId: {
        type: "string",
        // An enum of real IDs stops the model from inventing tours.
        enum: App.page.tourIds(),
        description: "Tour id from website_get_tours_state.",
      },
      date: {
        type: "string",
        format: "date",
        description: "Trip date as YYYY-MM-DD.",
      },
      time: {
        type: "string",
        enum: App.page.departureTimes(),
        description: "Departure time as HH:MM, one of the tour's times.",
      },
    };
  }

  /**
   * Describe the write that adds a trip to the basket.
   *
   * :return: The action definition.
   */
  static addTripAction() {
    const properties = Object.assign(SiteActions.departureProperties(), SiteActions.ticketProperties());
    return {
      name: "add_trip_to_basket",
      description: "Add one departure for a party to the basket, or replace the basket's trip for that departure. Returns the basket with its new version, or ok false with the site's reason. The site does not check children's ages. Does not reserve.",
      // "write" runs immediately. The visitor can remove the trip on the page.
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["tourId", "date", "time", "adults", "children", "under4s"],
        properties: properties,
      },
      execute: SiteActions.addTrip,
    };
  }

  /**
   * Add a trip through the page's own basket operation.
   *
   * :param args: The validated departure and tickets.
   * :return: The added trip and the basket, which becomes the tool receipt.
   */
  static addTrip(args) {
    return App.page.addTrip(args);
  }

  /**
   * Describe the write that takes a trip out of the basket.
   *
   * :return: The action definition.
   */
  static removeTripAction() {
    return {
      name: "remove_trip_from_basket",
      description: "Take one trip out of the basket, by its tourId, date and time from the basket. Returns the basket with its new version, or ok false with the site's reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["tourId", "date", "time"],
        properties: SiteActions.departureProperties(),
      },
      execute: SiteActions.removeTrip,
    };
  }

  /**
   * Remove a trip through the page's own basket operation.
   *
   * :param args: The validated departure.
   * :return: The removed trip and the basket.
   */
  static removeTrip(args) {
    return App.page.removeTrip(args.tourId, args.date, args.time);
  }

  /**
   * Describe the irreversible reservation of the basket's trips.
   *
   * :return: The action definition.
   */
  static reserveAction() {
    return {
      name: "reserve_basket",
      description: "Reserve every trip in the basket under the visitor's details. The browser asks the visitor to confirm first. The site refuses a stale expectedVersion. Returns the reservation code, or ok false with the site's reason. Takes no payment.",
      // "irreversible" makes the runtime open a confirmation dialog before execute runs.
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["firstName", "lastName", "email", "phone", "expectedVersion"],
        properties: {
          firstName: {
            type: "string",
            maxLength: 60,
            description: "The visitor's first name.",
          },
          lastName: {
            type: "string",
            maxLength: 60,
            description: "The visitor's last name.",
          },
          email: {
            type: "string",
            maxLength: 120,
            description: "The visitor's email.",
          },
          phone: {
            type: "string",
            maxLength: 20,
            description: "The visitor's mobile phone, for weather calls.",
          },
          notes: {
            type: "string",
            maxLength: 1000,
            description: "Optional notes from the visitor, such as access needs.",
          },
          expectedVersion: {
            type: "integer",
            minimum: 0,
            description: "The latest basket version in this turn: from website_get_tours_state, or from a basket change made after that read.",
          },
        },
      },
      execute: SiteActions.reserve,
    };
  }

  /**
   * Reserve through the same operation the page's own form uses.
   *
   * :param args: The validated, visitor-confirmed arguments.
   * :return: The reservation, or {ok: false, reason} when the site refuses it.
   * :raises Error: Only on an unexpected failure; the runtime then reports "unknown".
   */
  static reserve(args) {
    return App.page.reserveTrips(args);
  }

  /**
   * Give the arguments that name one reservation.
   *
   * :return: The code and lastName schemas.
   */
  static reservationProperties() {
    return {
      code: {
        type: "string",
        maxLength: 12,
        description: "Reservation code from the visitor, such as HT-3MVK.",
      },
      lastName: {
        type: "string",
        maxLength: 60,
        description: "The last name on the reservation, from the visitor.",
      },
    };
  }

  /**
   * Describe the read that looks up one reservation.
   *
   * :return: The action definition.
   */
  static lookUpAction() {
    return {
      name: "look_up_reservation",
      description: "Look up a reservation by its code and the last name on it. Returns its status, trips, total and the last day to cancel online, or ok false with the site's reason. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["code", "lastName"],
        properties: SiteActions.reservationProperties(),
      },
      execute: SiteActions.lookUp,
    };
  }

  /**
   * Look up a reservation through the page's own trip book.
   *
   * :param args: The validated code and last name.
   * :return: The reservation, or ok false with the site's reason.
   */
  static lookUp(args) {
    return App.page.lookUpReservation(args.code, args.lastName);
  }

  /**
   * Describe the irreversible cancellation of a reservation.
   *
   * :return: The action definition.
   */
  static cancelAction() {
    return {
      name: "cancel_reservation",
      description: "Cancel every trip in a reservation, by its code and last name. The browser asks the visitor to confirm first. Returns the cancelled reservation, or ok false with the site's reason.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["code", "lastName"],
        properties: SiteActions.reservationProperties(),
      },
      execute: SiteActions.cancel,
    };
  }

  /**
   * Cancel through the same operation the page's own cancel button uses.
   *
   * :param args: The validated, visitor-confirmed code and last name.
   * :return: The cancelled reservation, or {ok: false, reason} when the site refuses.
   * :raises Error: Only on an unexpected failure; the runtime then reports "unknown".
   */
  static cancel(args) {
    return App.page.cancelBooking(args.code, args.lastName);
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;

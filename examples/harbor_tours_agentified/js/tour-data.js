/**
 * The tour company's trips, booking limits, harbor dues and existing
 * reservations.
 *
 * Prices are whole US cents. policies.html repeats the harbor dues, the
 * booking limits, the Twilight Sail's age limit, and which trips take dogs and
 * wheelchairs, so change both together.
 */
export class TourData {
  /**
   * The tours. days holds getUTCDay() numbers (0 is Sunday), listed from
   * Monday, because the page describes them in that order. times are "HH:MM".
   * places is how many adults and children one departure takes.
   */
  static TOURS = [
    {
      id: "seal-rocks",
      name: "Seal Rocks Cruise",
      kind: "boat",
      vessel: "Kittiwake",
      minutes: 90,
      days: [1, 2, 3, 4, 5, 6, 0],
      times: ["10:00", "14:00"],
      places: 12,
      adultPrice: 3800,
      childPrice: 2200,
      minAge: 0,
      dogsWelcome: false,
      highlights: ["Grey seals hauled out on the Skerry Rocks", "The skipper's stories of the coast", "Binoculars on board"],
      access: "Board down two steps from the pontoon. The crew can help, but wheelchairs can't board.",
    },
    {
      id: "harbor-loop",
      name: "Harbor and Lighthouse Loop",
      kind: "boat",
      vessel: "Marrow Belle",
      minutes: 60,
      days: [1, 2, 3, 4, 5, 6, 0],
      times: ["11:30", "15:00"],
      places: 20,
      adultPrice: 2400,
      childPrice: 1400,
      minAge: 0,
      dogsWelcome: true,
      highlights: ["The 1871 lighthouse up close", "Fishing boats and the lifeboat station", "Covered seating"],
      access: "Step-free boarding by ramp, with space for one wheelchair and an accessible toilet.",
    },
    {
      id: "twilight-sail",
      name: "Twilight Sail",
      kind: "boat",
      vessel: "Wren",
      minutes: 120,
      days: [5, 6],
      times: ["16:00"],
      places: 8,
      adultPrice: 5500,
      childPrice: 4000,
      minAge: 12,
      dogsWelcome: false,
      highlights: ["Under sail when the wind allows", "Harbor lights at dusk", "Blankets and hot chocolate"],
      access: "Climb over the side from the pontoon, with a hand from the crew. Wheelchairs can't board.",
    },
    {
      id: "sea-wall-walk",
      name: "Sea Wall History Walk",
      kind: "walk",
      vessel: null,
      minutes: 75,
      days: [3, 6, 0],
      times: ["10:30"],
      places: 16,
      adultPrice: 1500,
      childPrice: 500,
      minAge: 0,
      dogsWelcome: true,
      highlights: ["Stories of the 1953 storm", "The old lifeboat station", "A local guide all the way"],
      access: "Level and step-free along the sea wall, with one 300 m gravel stretch.",
    },
  ];

  /** The Marrow Point harbor dues, per passenger aged 4 and over, on boat trips only. */
  static HARBOR_DUES = 150;

  /** The most places one reservation can take on one departure. */
  static MAX_PLACES = 8;

  /** The most trips in the basket and in one reservation. */
  static MAX_TRIPS = 4;

  /** The furthest date visitors can book, in days from today. The nearest is tomorrow. */
  static BOOK_AHEAD_DAYS = 60;

  /**
   * Reservations other visitors have made. Each trip runs on the first date,
   * at least fromToday days from today, on which its tour runs. So the
   * reservations move with the date and always land on a running day.
   */
  static EXISTING_RESERVATIONS = [
    {
      code: "HT-3MVK",
      firstName: "Elsie",
      lastName: "Thorne",
      trips: [
        {
          tourId: "seal-rocks",
          fromToday: 1,
          time: "10:00",
          adults: 2,
          children: 2,
          under4s: 0,
        },
      ],
    },
    {
      code: "HT-8RPD",
      firstName: "Hugo",
      lastName: "Brandt",
      trips: [
        {
          tourId: "seal-rocks",
          fromToday: 1,
          time: "10:00",
          adults: 6,
          children: 2,
          under4s: 1,
        },
      ],
    },
    {
      code: "HT-W7NB",
      firstName: "Colm",
      lastName: "Doyle",
      trips: [
        {
          tourId: "seal-rocks",
          fromToday: 1,
          time: "14:00",
          adults: 2,
          children: 2,
          under4s: 1,
        },
      ],
    },
    {
      code: "HT-5JXT",
      firstName: "Ines",
      lastName: "Moreau",
      trips: [
        {
          tourId: "seal-rocks",
          fromToday: 1,
          time: "14:00",
          adults: 6,
          children: 0,
          under4s: 0,
        },
      ],
    },
    {
      code: "HT-K2HC",
      firstName: "Rami",
      lastName: "Osei",
      trips: [
        {
          tourId: "harbor-loop",
          fromToday: 0,
          time: "15:00",
          adults: 2,
          children: 0,
          under4s: 0,
        },
      ],
    },
    {
      code: "HT-T6FY",
      firstName: "Tess",
      lastName: "Lindqvist",
      trips: [
        {
          tourId: "twilight-sail",
          fromToday: 1,
          time: "16:00",
          adults: 2,
          children: 0,
          under4s: 0,
        },
        {
          tourId: "sea-wall-walk",
          fromToday: 1,
          time: "10:30",
          adults: 2,
          children: 0,
          under4s: 0,
        },
      ],
    },
    {
      code: "HT-B9QS",
      firstName: "Ezra",
      lastName: "Kahale",
      trips: [
        {
          tourId: "twilight-sail",
          fromToday: 1,
          time: "16:00",
          adults: 4,
          children: 0,
          under4s: 0,
        },
      ],
    },
    {
      code: "HT-D3GU",
      firstName: "Maud",
      lastName: "Pryce",
      trips: [
        {
          tourId: "sea-wall-walk",
          fromToday: 1,
          time: "10:30",
          adults: 2,
          children: 2,
          under4s: 0,
        },
      ],
    },
  ];

  /**
   * Find a tour by its id.
   *
   * :param list: TOURS
   * :param id: the id to look for
   * :return: the matching item, or null
   */
  static findById(list, id) {
    for (const item of list) {
      if (item.id === id) return item;
    }
    return null;
  }
}

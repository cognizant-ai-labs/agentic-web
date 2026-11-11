/**
 * The guesthouse's rooms, extras, fees, house rules and existing bookings.
 *
 * Prices are whole US cents. policies.html shows the same fees and
 * cancellation tiers to guests, so change both together.
 */
export class GuesthouseData {
  /** The rooms. The weekend rate is for Friday and Saturday nights. */
  static ROOMS = [
    {
      id: "harbor-view",
      name: "Harbor View Room",
      beds: "1 queen bed",
      maxGuests: 2,
      nightlyRate: 14500,
      weekendRate: 17500,
      amenities: ["Bay window over the harbor", "Shower room", "Writing desk"],
      accessibility: "Second floor, up 22 stairs. There is no elevator.",
      petFriendly: false,
    },
    {
      id: "lantern",
      name: "Lantern Room",
      beds: "1 double bed and 1 single daybed",
      maxGuests: 3,
      nightlyRate: 12500,
      weekendRate: 15000,
      amenities: ["Skylight under the eaves", "Shower room", "Reading nook"],
      accessibility: "Top floor, up two flights of stairs, with low beams.",
      petFriendly: false,
    },
    {
      id: "garden",
      name: "Garden Room",
      beds: "1 queen bed",
      maxGuests: 2,
      nightlyRate: 13500,
      weekendRate: 16000,
      amenities: ["Private patio", "Roll-in shower with grab rails", "Own door to the garden"],
      accessibility: "Ground floor, step-free from the side gate.",
      petFriendly: true,
    },
    {
      id: "net-loft",
      name: "Net Loft Suite",
      beds: "1 king bed and 1 double sofa bed",
      maxGuests: 4,
      nightlyRate: 21000,
      weekendRate: 25000,
      amenities: ["Separate sitting room", "Kitchenette", "Bath and shower"],
      accessibility: "First floor, up 14 stairs. There is no elevator.",
      petFriendly: false,
    },
  ];

  /** Extras. Each price is per "guest per night", per "night" or per "stay". */
  static EXTRAS = [
    {
      id: "breakfast",
      name: "Harbor breakfast",
      price: 1400,
      per: "guest per night",
    },
    {
      id: "parking",
      name: "Parking space",
      price: 1000,
      per: "night",
    },
    {
      id: "late-checkout",
      name: "Late checkout until 1 pm",
      price: 2500,
      per: "stay",
    },
  ];

  /** The cleaning fee, once per stay. */
  static CLEANING_FEE = 3000;

  /** The Marrow Point tourist tax, per guest per night. */
  static TOURIST_TAX = 250;

  /** Stays that include a Saturday night need at least this many nights. */
  static SATURDAY_MIN_NIGHTS = 2;

  /** The longest stay guests can book online. */
  static MAX_NIGHTS = 14;

  /**
   * Cancellation tiers, checked in order. A tier applies when check-in is at
   * least minDays away. feeShare is the part of the room charge we keep.
   */
  static CANCELLATION_TIERS = [
    {
      minDays: 7,
      feeShare: 0,
      rule: "7 or more days before check-in: free",
    },
    {
      minDays: 2,
      feeShare: 0.5,
      rule: "2 to 6 days before check-in: 50% of the room charge",
    },
    {
      minDays: 0,
      feeShare: 1,
      rule: "the day before or the day of check-in: the full room charge",
    },
  ];

  /** Arrival times guests can choose. Check-in is from 3 pm to 9 pm. */
  static ARRIVAL_TIMES = ["3 pm to 5 pm", "5 pm to 7 pm", "7 pm to 9 pm", "After 9 pm (self check-in)"];

  /**
   * Bookings other guests have made. daysFromToday is the number of days from
   * today to check-in, so the bookings move with the date.
   */
  static EXISTING_BOOKINGS = [
    {
      code: "TW-7KQ2",
      roomId: "harbor-view",
      firstName: "Iris",
      lastName: "Pell",
      daysFromToday: 0,
      nights: 3,
      guests: 2,
    },
    {
      code: "TW-M3XD",
      roomId: "garden",
      firstName: "Tomas",
      lastName: "Reyes",
      daysFromToday: 1,
      nights: 4,
      guests: 2,
    },
    {
      code: "TW-C8VN",
      roomId: "lantern",
      firstName: "Ada",
      lastName: "Marsh",
      daysFromToday: 2,
      nights: 2,
      guests: 3,
    },
    {
      code: "TW-9PLF",
      roomId: "net-loft",
      firstName: "June",
      lastName: "Okoro",
      daysFromToday: 2,
      nights: 4,
      guests: 4,
    },
    {
      code: "TW-R2TB",
      roomId: "harbor-view",
      firstName: "Leo",
      lastName: "Fenn",
      daysFromToday: 6,
      nights: 4,
      guests: 2,
    },
    {
      code: "TW-W6HJ",
      roomId: "garden",
      firstName: "Mina",
      lastName: "Castell",
      daysFromToday: 9,
      nights: 7,
      guests: 1,
    },
    {
      code: "TW-4DZS",
      roomId: "lantern",
      firstName: "Noel",
      lastName: "Ashby",
      daysFromToday: 11,
      nights: 3,
      guests: 2,
    },
    {
      code: "TW-K5GY",
      roomId: "net-loft",
      firstName: "Ruth",
      lastName: "Delacroix",
      daysFromToday: 15,
      nights: 6,
      guests: 3,
    },
    {
      code: "TW-P7NE",
      roomId: "harbor-view",
      firstName: "Sam",
      lastName: "Whitlow",
      daysFromToday: 19,
      nights: 2,
      guests: 2,
    },
    {
      code: "TW-B3QA",
      roomId: "garden",
      firstName: "Ola",
      lastName: "Brennan",
      daysFromToday: 27,
      nights: 10,
      guests: 2,
    },
    {
      code: "TW-H8WD",
      roomId: "harbor-view",
      firstName: "Cora",
      lastName: "Baptiste",
      daysFromToday: 33,
      nights: 5,
      guests: 2,
    },
    {
      code: "TW-F2RU",
      roomId: "lantern",
      firstName: "Bea",
      lastName: "Laurent",
      daysFromToday: 41,
      nights: 6,
      guests: 2,
    },
    {
      code: "TW-T9MC",
      roomId: "net-loft",
      firstName: "Hal",
      lastName: "Quint",
      daysFromToday: 48,
      nights: 3,
      guests: 4,
    },
  ];

  /**
   * Find a room or an extra by its id.
   *
   * :param list: ROOMS or EXTRAS
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

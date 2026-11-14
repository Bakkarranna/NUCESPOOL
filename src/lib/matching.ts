export interface CostSplitResult {
  totalCost: number;
  confirmedPassengers: number;
  divisor: number;
  currentPerPerson: number;
  fullCapacityPerPerson: number;
  projectedWithNewSeat: number;
  driverIncluded: boolean;
  costMethod: string;
}

export function calculateDailyCostSplit(params: {
  estimatedTotalCost: number;
  totalSeatsOffered: number;
  availableSeats: number;
  costMethod: string;
  includeDriverInSplit: boolean;
  additionalSeats?: number;
}): CostSplitResult {
  const {
    estimatedTotalCost,
    totalSeatsOffered,
    availableSeats,
    costMethod,
    includeDriverInSplit,
    additionalSeats = 1,
  } = params;

  const bookedSeats = Math.max(0, totalSeatsOffered - availableSeats);

  if (costMethod === 'fixed_per_seat') {
    const perSeat = Math.round(estimatedTotalCost / Math.max(1, totalSeatsOffered));
    return {
      totalCost: estimatedTotalCost,
      confirmedPassengers: bookedSeats,
      divisor: totalSeatsOffered,
      currentPerPerson: perSeat,
      fullCapacityPerPerson: perSeat,
      projectedWithNewSeat: perSeat,
      driverIncluded: includeDriverInSplit,
      costMethod,
    };
  }

  const driverCount = includeDriverInSplit ? 1 : 0;
  const currentDivisor = Math.max(1, bookedSeats + driverCount);
  const projectedDivisor = Math.max(1, bookedSeats + additionalSeats + driverCount);
  const fullDivisor = Math.max(1, totalSeatsOffered + driverCount);

  return {
    totalCost: estimatedTotalCost,
    confirmedPassengers: bookedSeats,
    divisor: currentDivisor,
    currentPerPerson: Math.round(estimatedTotalCost / currentDivisor),
    fullCapacityPerPerson: Math.round(estimatedTotalCost / fullDivisor),
    projectedWithNewSeat: Math.round(estimatedTotalCost / projectedDivisor),
    driverIncluded: includeDriverInSplit,
    costMethod,
  };
}

export interface MatchBreakdown {
  totalScore: number;
  routeScore: number; // max 40
  departureScore: number; // max 25
  pickupScore: number; // max 20
  returnScore: number; // max 15
  reasons: string[];
}

function timeToMinutes(hhmm?: string | null): number | null {
  if (!hhmm || !hhmm.includes(':')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function getDayClassWindow(
  slots: { dayOfWeek: string; classStartTime: string; classEndTime: string }[] | undefined,
  travelDate?: string | null
): { firstClassTime: string | null; lastClassTime: string | null; dayLabel: string | null } {
  if (!slots || slots.length === 0) {
    return { firstClassTime: null, lastClassTime: null, dayLabel: null };
  }

  let targetDay: string | null = null;
  if (travelDate && travelDate.length >= 10) {
    const parsed = new Date(`${travelDate.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      targetDay = WEEKDAY_SHORT[parsed.getDay()];
    }
  }

  const daySlots = targetDay
    ? slots.filter((s) => s.dayOfWeek.toLowerCase() === targetDay!.toLowerCase())
    : [];

  const pool = daySlots.length > 0 ? daySlots : slots;
  let minStartMins = Infinity;
  let maxEndMins = -Infinity;
  let firstClassTime: string | null = null;
  let lastClassTime: string | null = null;

  for (const s of pool) {
    const sm = timeToMinutes(s.classStartTime);
    const em = timeToMinutes(s.classEndTime);
    if (sm !== null && sm < minStartMins) {
      minStartMins = sm;
      firstClassTime = s.classStartTime;
    }
    if (em !== null && em > maxEndMins) {
      maxEndMins = em;
      lastClassTime = s.classEndTime;
    }
  }

  return {
    firstClassTime,
    lastClassTime,
    dayLabel: daySlots.length > 0 ? targetDay : null,
  };
}

export function computeRideCompatibility(params: {
  rideOriginCity: string;
  rideDestinationCity: string;
  ridePickupPoints: string;
  rideDepartureTime: string;
  rideReturnTime?: string | null;
  userHomeArea?: string | null;
  userPreferredDeparture?: string | null;
  userPreferredReturn?: string | null;
  userFirstClassTime?: string | null;
  userLastClassTime?: string | null;
  preferredDirection?: string;
}): MatchBreakdown {
  const reasons: string[] = [];

  // 1. Route compatibility (40%)
  let routeScore = 36;
  if (params.preferredDirection && params.preferredDirection !== 'all') {
    const dir = `${params.rideOriginCity}->${params.rideDestinationCity}`;
    if (dir === params.preferredDirection) {
      routeScore = 40;
      reasons.push(`Direct ${params.rideOriginCity} → ${params.rideDestinationCity} corridor`);
    } else {
      routeScore = 12;
    }
  } else {
    routeScore = 40;
    reasons.push(`${params.rideOriginCity} → ${params.rideDestinationCity} active route`);
  }

  // 2. Departure time compatibility (25%)
  let departureScore = 16;
  const rideDepMins = timeToMinutes(params.rideDepartureTime);
  const classStartMins = timeToMinutes(params.userFirstClassTime);
  const prefDepMins = timeToMinutes(params.userPreferredDeparture);

  if (rideDepMins !== null && classStartMins !== null) {
    // Ideal departure from Chiniot/Faisalabad is 45-90 mins before first class
    const targetArrival = classStartMins - 60;
    const diff = Math.abs(rideDepMins - targetArrival);
    if (diff <= 20) {
      departureScore = 25;
      reasons.push(`Arrives cleanly before ${params.userFirstClassTime} class`);
    } else if (diff <= 45) {
      departureScore = 20;
      reasons.push(`Within 45 min of ${params.userFirstClassTime} class window`);
    } else if (diff <= 90) {
      departureScore = 12;
    } else {
      departureScore = 5;
    }
  } else if (rideDepMins !== null && prefDepMins !== null) {
    const diff = Math.abs(rideDepMins - prefDepMins);
    if (diff <= 15) {
      departureScore = 25;
      reasons.push(`Matches ${params.userPreferredDeparture} preferred departure`);
    } else if (diff <= 40) {
      departureScore = 18;
    } else {
      departureScore = 8;
    }
  }

  // 3. Pickup location proximity (20%)
  let pickupScore = 10;
  if (params.userHomeArea && params.userHomeArea.trim().length > 1) {
    const homeTokens = params.userHomeArea
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((t) => t.length > 2);
    const haystack = `${params.rideOriginCity} ${params.ridePickupPoints}`.toLowerCase();
    const matchedToken = homeTokens.find((t) => haystack.includes(t));
    if (matchedToken) {
      pickupScore = 20;
      reasons.push(`Passes near ${params.userHomeArea}`);
    } else {
      pickupScore = 11;
    }
  }

  // 4. Return schedule compatibility (15%)
  let returnScore = 9;
  const rideRetMins = timeToMinutes(params.rideReturnTime);
  const classEndMins = timeToMinutes(params.userLastClassTime);
  const prefRetMins = timeToMinutes(params.userPreferredReturn);

  if (rideRetMins !== null && classEndMins !== null) {
    const diff = Math.abs(rideRetMins - (classEndMins + 20));
    if (diff <= 25) {
      returnScore = 15;
      reasons.push(`Return ${params.rideReturnTime} aligns with ${params.userLastClassTime} dismissal`);
    } else if (diff <= 60) {
      returnScore = 11;
    } else {
      returnScore = 5;
    }
  } else if (rideRetMins !== null && prefRetMins !== null) {
    const diff = Math.abs(rideRetMins - prefRetMins);
    returnScore = diff <= 30 ? 15 : diff <= 60 ? 10 : 5;
  }

  const totalScore = Math.min(100, routeScore + departureScore + pickupScore + returnScore);
  return {
    totalScore,
    routeScore,
    departureScore,
    pickupScore,
    returnScore,
    reasons,
  };
}

import { count } from 'drizzle-orm';
import { db } from './index.ts';
import {
  bookings,
  campuses,
  messages,
  notifications,
  reports,
  reviews,
  rideSchedules,
  rides,
  routes,
  timetableSlots,
  transportServices,
  universities,
  users,
  vehicles,
} from './schema.ts';

let seedPromise: Promise<void> | null = null;

function formatDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeed(): Promise<void> {
  const existingUnis = await db.select({ value: count() }).from(universities);
  if ((existingUnis[0]?.value ?? 0) > 0) {
    return;
  }

  const [uni] = await db
    .insert(universities)
    .values({
      name: 'FAST National University of Computer and Emerging Sciences',
      shortCode: 'FAST-NUCES',
      emailDomain: 'nu.edu.pk',
    })
    .returning();

  const [campusChiniot] = await db
    .insert(campuses)
    .values({
      universityId: uni.id,
      name: 'Chiniot-Faisalabad Campus',
      city: 'Chiniot',
      address: 'Loonaywala Stop, Sargodha Road, Chiniot',
      isActive: true,
    })
    .returning();

  const [routeChtFsd, routeFsdCht] = await db
    .insert(routes)
    .values([
      {
        campusId: campusChiniot.id,
        originCity: 'Chiniot',
        destinationCity: 'Faisalabad',
        corridorLabel: 'Chiniot → Faisalabad',
        distanceKm: 42,
        isActive: true,
      },
      {
        campusId: campusChiniot.id,
        originCity: 'Faisalabad',
        destinationCity: 'Chiniot',
        corridorLabel: 'Faisalabad → Chiniot',
        distanceKm: 42,
        isActive: true,
      },
    ])
    .returning();

  const [hamza, ayesha, bilal, zoya, usman] = await db
    .insert(users)
    .values([
      {
        uid: 'seed-hamza-22f',
        email: 'hamza.tariq@cfd.nu.edu.pk',
        fullName: 'Hamza Tariq',
        nuEmail: 'f223104@cfd.nu.edu.pk',
        rollNumber: '22F-3104',
        phone: '+92 300 7142289',
        universityId: uni.id,
        campusId: campusChiniot.id,
        department: 'Computer Science',
        semester: '7th Semester',
        homeArea: 'Satellite Town, Chiniot',
        preferredDeparture: '07:30',
        preferredReturn: '15:30',
        studentIdNote: 'Verified FAST ID Card #22F-3104',
        verificationStatus: 'verified',
        cnicNumber: '33100-7142289-1',
        cnicVerificationStatus: 'verified',
        studentCardStatus: 'verified',
        isDriver: true,
        isCoordinator: false,
        isAdmin: false,
        ratingAvg: '4.90',
        ratingCount: 14,
      },
      {
        uid: 'seed-ayesha-23f',
        email: 'ayesha.nadeem@cfd.nu.edu.pk',
        fullName: 'Ayesha Nadeem',
        nuEmail: 'f233418@cfd.nu.edu.pk',
        rollNumber: '23F-3418',
        phone: '+92 321 8841205',
        universityId: uni.id,
        campusId: campusChiniot.id,
        department: 'Software Engineering',
        semester: '5th Semester',
        homeArea: 'Peoples Colony No. 1, Faisalabad',
        preferredDeparture: '07:45',
        preferredReturn: '16:00',
        studentIdNote: 'Verified FAST ID Card #23F-3418',
        verificationStatus: 'verified',
        cnicNumber: '33100-8841205-2',
        cnicVerificationStatus: 'verified',
        studentCardStatus: 'verified',
        isDriver: false,
        isCoordinator: true,
        isAdmin: false,
        ratingAvg: '4.85',
        ratingCount: 19,
      },
      {
        uid: 'seed-bilal-24f',
        email: 'bilal.ahmad@cfd.nu.edu.pk',
        fullName: 'Bilal Ahmad',
        nuEmail: 'f243089@cfd.nu.edu.pk',
        rollNumber: '24F-3089',
        phone: '+92 333 6509112',
        universityId: uni.id,
        campusId: campusChiniot.id,
        department: 'Artificial Intelligence',
        semester: '3rd Semester',
        homeArea: 'Canal Road, Faisalabad',
        preferredDeparture: '07:40',
        preferredReturn: '15:15',
        studentIdNote: 'Verified FAST ID Card #24F-3089',
        verificationStatus: 'verified',
        cnicNumber: '33100-6509112-3',
        cnicVerificationStatus: 'verified',
        studentCardStatus: 'verified',
        isDriver: true,
        isCoordinator: false,
        isAdmin: false,
        ratingAvg: '4.70',
        ratingCount: 6,
      },
      {
        uid: 'seed-zoya-23f',
        email: 'zoya.khalid@cfd.nu.edu.pk',
        fullName: 'Zoya Khalid',
        nuEmail: 'f233612@cfd.nu.edu.pk',
        rollNumber: '23F-3612',
        phone: '+92 345 7710394',
        universityId: uni.id,
        campusId: campusChiniot.id,
        department: 'Data Science',
        semester: '5th Semester',
        homeArea: 'Jhang Road, Chiniot',
        preferredDeparture: '08:00',
        preferredReturn: '15:30',
        studentIdNote: 'Uploaded Student Card — awaiting verification',
        verificationStatus: 'pending',
        cnicVerificationStatus: 'unsubmitted',
        studentCardStatus: 'pending',
        isDriver: false,
        isCoordinator: false,
        isAdmin: false,
        ratingAvg: '5.00',
        ratingCount: 0,
      },
      {
        uid: 'seed-usman-21f',
        email: 'usman.raza@cfd.nu.edu.pk',
        fullName: 'Usman Raza',
        nuEmail: 'f213044@cfd.nu.edu.pk',
        rollNumber: '21F-3044',
        phone: '+92 301 5129980',
        universityId: uni.id,
        campusId: campusChiniot.id,
        department: 'Electrical Engineering',
        semester: '8th Semester',
        homeArea: 'D-Ground, Faisalabad',
        preferredDeparture: '07:30',
        preferredReturn: '14:30',
        studentIdNote: 'Verified FAST ID Card #21F-3044',
        verificationStatus: 'verified',
        cnicNumber: '33100-5129980-5',
        cnicVerificationStatus: 'verified',
        studentCardStatus: 'verified',
        isDriver: true,
        isCoordinator: false,
        isAdmin: false,
        ratingAvg: '4.80',
        ratingCount: 9,
      },
    ])
    .returning();

  const [civic, honda125, alto] = await db
    .insert(vehicles)
    .values([
      {
        ownerUserId: hamza.id,
        category: 'car',
        makeModel: 'Honda Civic 2021',
        registrationNumber: 'FSD-21-4820',
        color: 'Crystal White',
        capacity: 4,
        driverName: 'Hamza Tariq',
        driverPhone: '+92 300 7142289',
        isSelfDriven: true,
        verificationStatus: 'verified',
      },
      {
        ownerUserId: bilal.id,
        category: 'motorcycle',
        makeModel: 'Honda CG 125',
        registrationNumber: 'CHT-24-9103',
        color: 'Black',
        capacity: 1,
        driverName: 'Bilal Ahmad',
        driverPhone: '+92 333 6509112',
        isSelfDriven: true,
        verificationStatus: 'verified',
      },
      {
        ownerUserId: usman.id,
        category: 'car',
        makeModel: 'Suzuki Alto VXL',
        registrationNumber: 'FSD-22-1194',
        color: 'Graphite Grey',
        capacity: 3,
        driverName: 'Raza Khan (Family Driver)',
        driverPhone: '+92 301 5129981',
        isSelfDriven: false,
        verificationStatus: 'pending',
      },
    ])
    .returning();

  const [carryService] = await db
    .insert(transportServices)
    .values([
      {
        coordinatorUserId: ayesha.id,
        serviceName: 'Faisalabad Morning Carry Pool',
        serviceType: 'carry',
        vehicleModel: 'Suzuki Bolan Carry 2020',
        registrationNumber: 'FSD-20-6632',
        capacity: 6,
        driverName: 'Ustad Shafiq Ahmed',
        driverPhone: '+92 302 9912340',
        authorizationNote: 'Daily contracted student carry authorized by 4 regular SE batch students.',
        verificationStatus: 'verified',
      },
    ])
    .returning();

  const [sched1, sched2] = await db
    .insert(rideSchedules)
    .values([
      {
        providerUserId: hamza.id,
        routeId: routeChtFsd.id,
        vehicleId: civic.id,
        originArea: 'Satellite Town, Chiniot',
        destinationArea: 'FAST-NUCES Campus / Canal Road, Faisalabad',
        pickupPoints: 'Satellite Town Gate · Chiniot Bridge · Loonaywala Stop',
        departureTime: '07:30',
        returnTime: '15:30',
        journeyType: 'round_trip',
        weekdays: 'Mon,Tue,Wed,Thu,Fri',
        offeredSeats: 3,
        estimatedTotalCost: 1200,
        costMethod: 'equal_split',
        includeDriverInSplit: false,
        notes: 'AC on during afternoon return. Helmet/seatbelt mandatory. Leave sharp at 07:30.',
      },
      {
        providerUserId: ayesha.id,
        routeId: routeFsdCht.id,
        transportServiceId: carryService.id,
        originArea: 'Peoples Colony No. 1, Faisalabad',
        destinationArea: 'FAST-NUCES Chiniot Campus',
        pickupPoints: 'D-Ground · Kohinoor Chowk · Gatwala Bridge · Loonaywala',
        departureTime: '07:40',
        returnTime: '16:00',
        journeyType: 'round_trip',
        weekdays: 'Mon,Tue,Wed,Thu,Fri',
        offeredSeats: 5,
        estimatedTotalCost: 1800,
        costMethod: 'equal_split',
        includeDriverInSplit: false,
        notes: 'Coordinated student carry driven by Ustad Shafiq. Cash collected at campus gate.',
      },
    ])
    .returning();

  const today = formatDateOffset(0);
  const tomorrow = formatDateOffset(1);
  const dayAfter = formatDateOffset(2);
  const pastDay = formatDateOffset(-2);

  const [ride1, ride2, ride3, ride4, pastRide] = await db
    .insert(rides)
    .values([
      {
        scheduleId: sched1.id,
        providerUserId: hamza.id,
        routeId: routeChtFsd.id,
        vehicleId: civic.id,
        originCity: 'Chiniot',
        originArea: 'Satellite Town, Chiniot',
        destinationCity: 'Faisalabad',
        destinationArea: 'FAST-NUCES Campus & Canal Road',
        pickupPoints: 'Satellite Town Gate · Chiniot Bridge · Loonaywala Stop',
        travelDate: today,
        departureTime: '07:30',
        returnTime: '15:30',
        journeyType: 'round_trip',
        totalSeatsOffered: 3,
        availableSeats: 2,
        estimatedTotalCost: 1200,
        costMethod: 'equal_split',
        includeDriverInSplit: false,
        notes: 'AC on for return leg. Confirm pickup 10 mins prior.',
        status: 'scheduled',
      },
      {
        scheduleId: sched2.id,
        providerUserId: ayesha.id,
        routeId: routeFsdCht.id,
        transportServiceId: carryService.id,
        originCity: 'Faisalabad',
        originArea: 'Peoples Colony No. 1, Faisalabad',
        destinationCity: 'Chiniot',
        destinationArea: 'FAST-NUCES Chiniot Campus',
        pickupPoints: 'D-Ground · Kohinoor Chowk · Gatwala · Loonaywala',
        travelDate: today,
        departureTime: '07:40',
        returnTime: '16:00',
        journeyType: 'round_trip',
        totalSeatsOffered: 5,
        availableSeats: 3,
        estimatedTotalCost: 1800,
        costMethod: 'equal_split',
        includeDriverInSplit: false,
        notes: 'Existing carry arrangement. Ustad Shafiq waits 5 mins at Kohinoor Chowk.',
        status: 'scheduled',
      },
      {
        providerUserId: bilal.id,
        routeId: routeFsdCht.id,
        vehicleId: honda125.id,
        originCity: 'Faisalabad',
        originArea: 'Canal Road / Millat Town, Faisalabad',
        destinationCity: 'Chiniot',
        destinationArea: 'FAST-NUCES Chiniot Campus',
        pickupPoints: 'Canal Road · Millat Chowk · Sargodha Road',
        travelDate: tomorrow,
        departureTime: '07:50',
        returnTime: '15:15',
        journeyType: 'morning',
        totalSeatsOffered: 1,
        availableSeats: 1,
        estimatedTotalCost: 500,
        costMethod: 'equal_split',
        includeDriverInSplit: true,
        notes: 'Spare helmet provided. Light backpack only.',
        status: 'scheduled',
      },
      {
        scheduleId: sched1.id,
        providerUserId: hamza.id,
        routeId: routeChtFsd.id,
        vehicleId: civic.id,
        originCity: 'Chiniot',
        originArea: 'Satellite Town, Chiniot',
        destinationCity: 'Faisalabad',
        destinationArea: 'FAST-NUCES Campus & Canal Road',
        pickupPoints: 'Satellite Town Gate · Chiniot Bridge · Loonaywala Stop',
        travelDate: dayAfter,
        departureTime: '07:30',
        returnTime: '15:30',
        journeyType: 'round_trip',
        totalSeatsOffered: 3,
        availableSeats: 3,
        estimatedTotalCost: 1200,
        costMethod: 'equal_split',
        includeDriverInSplit: false,
        notes: 'Weekly recurring morning run.',
        status: 'scheduled',
      },
      {
        providerUserId: hamza.id,
        routeId: routeChtFsd.id,
        vehicleId: civic.id,
        originCity: 'Chiniot',
        originArea: 'Satellite Town, Chiniot',
        destinationCity: 'Faisalabad',
        destinationArea: 'FAST-NUCES Campus',
        pickupPoints: 'Satellite Town Gate · Chiniot Bridge',
        travelDate: pastDay,
        departureTime: '07:30',
        returnTime: '15:30',
        journeyType: 'round_trip',
        totalSeatsOffered: 3,
        availableSeats: 1,
        estimatedTotalCost: 1000,
        costMethod: 'equal_split',
        includeDriverInSplit: false,
        notes: 'Completed weekday trip.',
        status: 'completed',
      },
    ])
    .returning();

  const [bookingCompleted] = await db
    .insert(bookings)
    .values([
      {
        rideId: pastRide.id,
        passengerUserId: bilal.id,
        seatsRequested: 2,
        pickupPoint: 'Chiniot Bridge',
        status: 'completed',
        agreedContribution: 500,
        cashConfirmed: true,
        passengerNote: 'Punctual morning pickup.',
      },
      {
        rideId: ride1.id,
        passengerUserId: ayesha.id,
        seatsRequested: 1,
        pickupPoint: 'Loonaywala Stop',
        status: 'accepted',
        agreedContribution: 600,
        cashConfirmed: false,
        passengerNote: 'Joining from main gate after lab.',
      },
      {
        rideId: ride2.id,
        passengerUserId: usman.id,
        seatsRequested: 2,
        pickupPoint: 'Kohinoor Chowk',
        status: 'accepted',
        agreedContribution: 450,
        cashConfirmed: false,
        passengerNote: '2 seats for morning SE lecture.',
      },
    ])
    .returning();

  await db.insert(timetableSlots).values([
    {
      userId: hamza.id,
      dayOfWeek: 'Mon',
      classStartTime: '08:30',
      classEndTime: '15:15',
      campusName: 'FAST-NUCES Chiniot-Faisalabad Campus',
      breakPeriod: '12:30 - 13:30',
      uploadedFileName: 'Fall2026_BSCS_7A.pdf',
      uploadedFileType: 'application/pdf',
    },
    {
      userId: hamza.id,
      dayOfWeek: 'Tue',
      classStartTime: '08:30',
      classEndTime: '15:15',
      campusName: 'FAST-NUCES Chiniot-Faisalabad Campus',
      breakPeriod: '13:00 - 14:00',
      uploadedFileName: 'Fall2026_BSCS_7A.pdf',
      uploadedFileType: 'application/pdf',
    },
  ]);

  await db.insert(reviews).values([
    {
      bookingId: bookingCompleted.id,
      rideId: pastRide.id,
      reviewerUserId: bilal.id,
      revieweeUserId: hamza.id,
      overallRating: 5,
      punctualityRating: 5,
      communicationRating: 5,
      experienceRating: 5,
      comment: 'Left Chiniot Bridge right on time and split cost transparently.',
    },
  ]);

  await db.insert(messages).values([
    {
      rideId: ride1.id,
      senderUserId: ayesha.id,
      receiverUserId: hamza.id,
      content: 'Salam Hamza, confirming my seat at Loonaywala Stop for 07:45 AM.',
      isRead: false,
    },
    {
      rideId: ride1.id,
      senderUserId: hamza.id,
      receiverUserId: ayesha.id,
      content: 'Walaikum Assalam, noted! I will be in the white Civic near the main stop.',
      isRead: false,
    },
  ]);

  await db.insert(reports).values([
    {
      reporterUserId: ayesha.id,
      reportedUserId: usman.id,
      rideId: ride2.id,
      category: 'Incorrect vehicle information',
      description: 'Requested driver check: please verify Suzuki Alto plate FSD-22-1194 before approval.',
      status: 'open',
    },
  ]);

  await db.insert(notifications).values([
    {
      userId: hamza.id,
      type: 'booking_accepted',
      title: 'Passenger confirmed for today',
      body: 'Ayesha Nadeem confirmed 1 seat from Loonaywala Stop.',
      relatedRideId: ride1.id,
      isRead: false,
    },
  ]);

  void ride3;
  void ride4;
  void zoya;
}

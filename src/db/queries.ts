import { and, asc, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  bookings,
  campuses,
  liveLocations,
  messageReactions,
  messages,
  notifications,
  reports,
  reviews,
  rideChallans,
  rideSchedules,
  rides,
  routes,
  timetableSlots,
  transportServices,
  universities,
  users,
  vehicles,
  verificationRecords,
} from './schema.ts';
import { ensureSeeded } from './seed.ts';
import { calculateDailyCostSplit } from '../lib/matching.ts';

export async function getPublicCatalog() {
  try {
    await ensureSeeded();

    const [
      uniRows,
      campusRows,
      routeRows,
      rideRows,
      vehicleRows,
      serviceRows,
      userRows,
      reviewRows,
      challanRows,
    ] = await Promise.all([
      db.select().from(universities),
      db.select().from(campuses).where(eq(campuses.isActive, true)),
      db.select().from(routes).where(eq(routes.isActive, true)),
      db
        .select()
        .from(rides)
        .where(eq(rides.status, 'scheduled'))
        .orderBy(asc(rides.travelDate), asc(rides.departureTime)),
      db.select().from(vehicles),
      db.select().from(transportServices),
      db
        .select({
          id: users.id,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
          department: users.department,
          semester: users.semester,
          homeArea: users.homeArea,
          verificationStatus: users.verificationStatus,
          cnicVerificationStatus: users.cnicVerificationStatus,
          studentCardStatus: users.studentCardStatus,
          ratingAvg: users.ratingAvg,
          ratingCount: users.ratingCount,
          isDriver: users.isDriver,
          isCoordinator: users.isCoordinator,
        })
        .from(users),
      db.select().from(reviews).orderBy(desc(reviews.createdAt)),
      db.select().from(rideChallans).orderBy(desc(rideChallans.createdAt)),
    ]);

    const userMap = new Map(
      userRows.map((u) => [
        u.id,
        {
          id: u.id,
          fullName: u.fullName,
          avatarUrl: u.avatarUrl,
          department: u.department,
          semester: u.semester,
          homeArea: u.homeArea,
          verificationStatus: u.verificationStatus,
          cnicVerified: u.cnicVerificationStatus === 'verified',
          studentCardVerified: u.studentCardStatus === 'verified',
          ratingAvg: u.ratingAvg,
          ratingCount: u.ratingCount,
          isDriver: u.isDriver,
          isCoordinator: u.isCoordinator,
        },
      ])
    );
    const vehicleMap = new Map(vehicleRows.map((v) => [v.id, v]));
    const serviceMap = new Map(serviceRows.map((s) => [s.id, s]));

    const challansByRide = new Map<
      number,
      Array<typeof challanRows[number] & { reportedByName: string }>
    >();
    for (const c of challanRows) {
      const list = challansByRide.get(c.rideId) ?? [];
      list.push({
        ...c,
        reportedByName: userMap.get(c.reportedByUserId)?.fullName ?? 'Student',
      });
      challansByRide.set(c.rideId, list);
    }

    const reviewsByProvider = new Map<
      number,
      {
        id: number;
        rideId: number;
        reviewerName: string;
        reviewerAvatarUrl: string | null;
        overallRating: number;
        punctualityRating: number;
        communicationRating: number;
        experienceRating: number;
        comment: string | null;
        createdAt: Date;
      }[]
    >();

    for (const rv of reviewRows) {
      const reviewer = userMap.get(rv.reviewerUserId);
      const list = reviewsByProvider.get(rv.revieweeUserId) ?? [];
      list.push({
        id: rv.id,
        rideId: rv.rideId,
        reviewerName: reviewer?.fullName ?? 'FAST Student',
        reviewerAvatarUrl: reviewer?.avatarUrl ?? null,
        overallRating: rv.overallRating,
        punctualityRating: rv.punctualityRating,
        communicationRating: rv.communicationRating,
        experienceRating: rv.experienceRating,
        comment: rv.comment,
        createdAt: rv.createdAt,
      });
      reviewsByProvider.set(rv.revieweeUserId, list);
    }

    const enrichedRides = rideRows.map((ride) => {
      const provider = userMap.get(ride.providerUserId);
      const vehicle = ride.vehicleId ? vehicleMap.get(ride.vehicleId) : null;
      const service = ride.transportServiceId
        ? serviceMap.get(ride.transportServiceId)
        : null;

      const split = calculateDailyCostSplit({
        estimatedTotalCost: ride.estimatedTotalCost,
        totalSeatsOffered: ride.totalSeatsOffered,
        availableSeats: ride.availableSeats,
        costMethod: ride.costMethod,
        includeDriverInSplit: ride.includeDriverInSplit,
      });

      const rideChallansList = challansByRide.get(ride.id) ?? [];
      const challanPerPersonTotal = rideChallansList
        .filter((c) => c.status === 'active')
        .reduce((sum, c) => sum + c.perPersonShare, 0);

      return {
        ...ride,
        provider: provider ?? null,
        providerReviews: (reviewsByProvider.get(ride.providerUserId) ?? []).slice(0, 10),
        vehicle: vehicle
          ? {
              id: vehicle.id,
              category: vehicle.category,
              makeModel: vehicle.makeModel,
              color: vehicle.color,
              capacity: vehicle.capacity,
              isSelfDriven: vehicle.isSelfDriven,
              driverName: vehicle.driverName,
              verificationStatus: vehicle.verificationStatus,
            }
          : null,
        transportService: service
          ? {
              id: service.id,
              serviceName: service.serviceName,
              serviceType: service.serviceType,
              vehicleModel: service.vehicleModel,
              capacity: service.capacity,
              driverName: service.driverName,
              verificationStatus: service.verificationStatus,
            }
          : null,
        costSplit: split,
        challans: rideChallansList,
        challanPerPersonTotal,
      };
    });

    return {
      universities: uniRows,
      campuses: campusRows,
      routes: routeRows,
      rides: enrichedRides,
    };
  } catch (error) {
    console.error('Database query failed in getPublicCatalog:', error);
    throw new Error('Failed to load rides catalog.', { cause: error });
  }
}

export async function getUserWorkspace(userId: number) {
  try {
    await ensureSeeded();

    const [
      userVehicles,
      userServices,
      userSchedules,
      userBookings,
      providerRides,
      userTimetable,
      userNotifications,
      userMessages,
      allUsers,
      allVehicles,
      allServices,
      allRides,
      userReviews,
      receivedReviewsRows,
      allChallans,
    ] = await Promise.all([
      db.select().from(vehicles).where(eq(vehicles.ownerUserId, userId)),
      db
        .select()
        .from(transportServices)
        .where(eq(transportServices.coordinatorUserId, userId)),
      db
        .select()
        .from(rideSchedules)
        .where(eq(rideSchedules.providerUserId, userId))
        .orderBy(desc(rideSchedules.createdAt)),
      db
        .select()
        .from(bookings)
        .where(eq(bookings.passengerUserId, userId))
        .orderBy(desc(bookings.createdAt)),
      db
        .select()
        .from(rides)
        .where(eq(rides.providerUserId, userId))
        .orderBy(asc(rides.travelDate), asc(rides.departureTime)),
      db
        .select()
        .from(timetableSlots)
        .where(eq(timetableSlots.userId, userId))
        .orderBy(asc(timetableSlots.classStartTime)),
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(30),
      db
        .select()
        .from(messages)
        .where(
          or(
            eq(messages.senderUserId, userId),
            eq(messages.receiverUserId, userId)
          )
        )
        .orderBy(asc(messages.createdAt)),
      db
        .select({
          id: users.id,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
          department: users.department,
          semester: users.semester,
          homeArea: users.homeArea,
          verificationStatus: users.verificationStatus,
          ratingAvg: users.ratingAvg,
          ratingCount: users.ratingCount,
          phone: users.phone,
        })
        .from(users),
      db.select().from(vehicles),
      db.select().from(transportServices),
      db.select().from(rides),
      db.select().from(reviews).where(eq(reviews.reviewerUserId, userId)),
      db
        .select()
        .from(reviews)
        .where(eq(reviews.revieweeUserId, userId))
        .orderBy(desc(reviews.createdAt)),
      db.select().from(rideChallans).orderBy(desc(rideChallans.createdAt)),
    ]);

    const messageIds = userMessages.map((m) => m.id);
    const reactionRows =
      messageIds.length > 0
        ? await db
            .select()
            .from(messageReactions)
            .where(inArray(messageReactions.messageId, messageIds))
        : [];

    const reactionsByMsg = new Map<
      number,
      Map<string, { count: number; userReacted: boolean }>
    >();
    for (const r of reactionRows) {
      let emojiMap = reactionsByMsg.get(r.messageId);
      if (!emojiMap) {
        emojiMap = new Map();
        reactionsByMsg.set(r.messageId, emojiMap);
      }
      const prev = emojiMap.get(r.emoji) ?? { count: 0, userReacted: false };
      emojiMap.set(r.emoji, {
        count: prev.count + 1,
        userReacted: prev.userReacted || r.userId === userId,
      });
    }

    const providerRideIds = providerRides.map((r) => r.id);
    const incomingBookings =
      providerRideIds.length > 0
        ? await db
            .select()
            .from(bookings)
            .where(inArray(bookings.rideId, providerRideIds))
            .orderBy(desc(bookings.createdAt))
        : [];

    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const rideMap = new Map(allRides.map((r) => [r.id, r]));
    const vehicleMap = new Map(allVehicles.map((v) => [v.id, v]));
    const serviceMap = new Map(allServices.map((s) => [s.id, s]));
    const myReviewByBookingId = new Map(userReviews.map((rv) => [rv.bookingId, rv]));

    const challansByRide = new Map<
      number,
      Array<typeof allChallans[number] & { reportedByName: string }>
    >();
    for (const c of allChallans) {
      const list = challansByRide.get(c.rideId) ?? [];
      list.push({
        ...c,
        reportedByName: userMap.get(c.reportedByUserId)?.fullName ?? 'Student',
      });
      challansByRide.set(c.rideId, list);
    }

    const enrichRideLite = (ride: typeof allRides[number]) => {
      const list = challansByRide.get(ride.id) ?? [];
      const challanPerPersonTotal = list
        .filter((c) => c.status === 'active')
        .reduce((sum, c) => sum + c.perPersonShare, 0);
      const split = calculateDailyCostSplit({
        estimatedTotalCost: ride.estimatedTotalCost,
        totalSeatsOffered: ride.totalSeatsOffered,
        availableSeats: ride.availableSeats,
        costMethod: ride.costMethod,
        includeDriverInSplit: ride.includeDriverInSplit,
      });
      return {
        ...ride,
        costSplit: split,
        challans: list,
        challanPerPersonTotal,
      };
    };

    const enrichedMyBookings = userBookings.map((b) => {
      const rawRide = rideMap.get(b.rideId);
      const ride = rawRide ? enrichRideLite(rawRide) : null;
      const provider = rawRide ? userMap.get(rawRide.providerUserId) : null;
      const vehicle = rawRide?.vehicleId ? vehicleMap.get(rawRide.vehicleId) : null;
      const service = rawRide?.transportServiceId
        ? serviceMap.get(rawRide.transportServiceId)
        : null;
      const myReview = myReviewByBookingId.get(b.id) ?? null;
      return {
        ...b,
        hasReviewed: Boolean(myReview),
        myReview,
        ride,
        provider: provider
          ? {
              ...provider,
              phone:
                b.status === 'accepted' || b.status === 'completed'
                  ? provider.phone
                  : null,
            }
          : null,
        vehicle: vehicle
          ? {
              id: vehicle.id,
              ownerUserId: vehicle.ownerUserId,
              category: vehicle.category,
              makeModel: vehicle.makeModel,
              registrationNumber: vehicle.registrationNumber,
              color: vehicle.color,
              capacity: vehicle.capacity,
              driverName: vehicle.driverName,
              driverPhone:
                b.status === 'accepted' || b.status === 'completed'
                  ? vehicle.driverPhone
                  : null,
              isSelfDriven: vehicle.isSelfDriven,
              verificationStatus: vehicle.verificationStatus,
            }
          : null,
        transportService: service
          ? {
              id: service.id,
              coordinatorUserId: service.coordinatorUserId,
              serviceName: service.serviceName,
              serviceType: service.serviceType,
              vehicleModel: service.vehicleModel,
              registrationNumber: service.registrationNumber,
              capacity: service.capacity,
              driverName: service.driverName,
              driverPhone:
                b.status === 'accepted' || b.status === 'completed'
                  ? service.driverPhone
                  : null,
              authorizationNote: service.authorizationNote,
              verificationStatus: service.verificationStatus,
            }
          : null,
      };
    });

    const enrichedProviderRides = providerRides.map(enrichRideLite);

    const enrichedIncomingBookings = incomingBookings.map((b) => {
      const passenger = userMap.get(b.passengerUserId);
      const ride = rideMap.get(b.rideId);
      return {
        ...b,
        ride: ride ?? null,
        passenger: passenger
          ? {
              ...passenger,
              phone:
                b.status === 'accepted' || b.status === 'completed'
                  ? passenger.phone
                  : null,
            }
          : null,
      };
    });

    const enrichedMessages = userMessages.map((m) => {
      const sender = userMap.get(m.senderUserId);
      const receiver = userMap.get(m.receiverUserId);
      const emojiMap = reactionsByMsg.get(m.id);
      const reactions = emojiMap
        ? Array.from(emojiMap.entries()).map(([emoji, stats]) => ({
            emoji,
            count: stats.count,
            userReacted: stats.userReacted,
          }))
        : [];
      return {
        ...m,
        senderName: sender?.fullName ?? 'Student',
        senderAvatarUrl: sender?.avatarUrl ?? null,
        receiverName: receiver?.fullName ?? 'Student',
        receiverAvatarUrl: receiver?.avatarUrl ?? null,
        rideLabel: rideMap.get(m.rideId)
          ? `${rideMap.get(m.rideId)!.originCity} → ${rideMap.get(m.rideId)!.destinationCity} (${rideMap.get(m.rideId)!.travelDate})`
          : `Ride #${m.rideId}`,
        reactions,
      };
    });

    const receivedReviews = receivedReviewsRows.map((rv) => {
      const reviewer = userMap.get(rv.reviewerUserId);
      const ride = rideMap.get(rv.rideId);
      return {
        id: rv.id,
        rideId: rv.rideId,
        reviewerName: reviewer?.fullName ?? 'FAST Student',
        reviewerAvatarUrl: reviewer?.avatarUrl ?? null,
        overallRating: rv.overallRating,
        punctualityRating: rv.punctualityRating,
        communicationRating: rv.communicationRating,
        experienceRating: rv.experienceRating,
        comment: rv.comment,
        createdAt: rv.createdAt,
        rideLabel: ride
          ? `${ride.originCity} → ${ride.destinationCity} (${ride.travelDate})`
          : `Ride #${rv.rideId}`,
      };
    });

    return {
      vehicles: userVehicles,
      transportServices: userServices,
      schedules: userSchedules,
      myBookings: enrichedMyBookings,
      providerRides: enrichedProviderRides,
      incomingBookings: enrichedIncomingBookings,
      timetable: userTimetable,
      notifications: userNotifications,
      messages: enrichedMessages,
      receivedReviews,
    };
  } catch (error) {
    console.error('Database query failed in getUserWorkspace:', error);
    throw new Error('Failed to load student workspace.', { cause: error });
  }
}

export async function createBookingTransactional(params: {
  rideId: number;
  passengerUserId: number;
  seatsRequested: number;
  pickupPoint: string;
  passengerNote?: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const [ride] = await tx
        .select()
        .from(rides)
        .where(eq(rides.id, params.rideId))
        .limit(1);

      if (!ride) {
        throw new Error('RIDE_NOT_FOUND');
      }
      if (ride.status !== 'scheduled') {
        throw new Error('RIDE_NOT_AVAILABLE');
      }
      if (ride.providerUserId === params.passengerUserId) {
        throw new Error('CANNOT_BOOK_OWN_RIDE');
      }
      if (params.seatsRequested < 1 || params.seatsRequested > ride.availableSeats) {
        throw new Error('INSUFFICIENT_SEATS');
      }

      const existingActive = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.rideId, params.rideId),
            eq(bookings.passengerUserId, params.passengerUserId),
            inArray(bookings.status, ['pending', 'accepted'])
          )
        );
      if (existingActive.length > 0) {
        throw new Error('DUPLICATE_BOOKING');
      }

      const split = calculateDailyCostSplit({
        estimatedTotalCost: ride.estimatedTotalCost,
        totalSeatsOffered: ride.totalSeatsOffered,
        availableSeats: ride.availableSeats,
        costMethod: ride.costMethod,
        includeDriverInSplit: ride.includeDriverInSplit,
        additionalSeats: params.seatsRequested,
      });

      const [booking] = await tx
        .insert(bookings)
        .values({
          rideId: params.rideId,
          passengerUserId: params.passengerUserId,
          seatsRequested: params.seatsRequested,
          pickupPoint: params.pickupPoint,
          status: 'pending',
          agreedContribution: split.projectedWithNewSeat * params.seatsRequested,
          passengerNote: params.passengerNote ?? null,
        })
        .returning();

      await tx.insert(notifications).values({
        userId: ride.providerUserId,
        type: 'new_request',
        title: 'New seat request',
        body: `A student requested ${params.seatsRequested} seat(s) from ${params.pickupPoint} on ${ride.travelDate}.`,
        relatedRideId: ride.id,
      });

      return booking;
    });
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'RIDE_NOT_FOUND',
        'RIDE_NOT_AVAILABLE',
        'CANNOT_BOOK_OWN_RIDE',
        'INSUFFICIENT_SEATS',
        'DUPLICATE_BOOKING',
      ].includes(error.message)
    ) {
      throw error;
    }
    console.error('Database query failed in createBookingTransactional:', error);
    throw new Error('Failed to create ride booking request.', { cause: error });
  }
}

export async function decideBookingTransactional(params: {
  bookingId: number;
  actorUserId: number;
  action: 'accept' | 'reject' | 'cancel' | 'complete' | 'no_show';
}) {
  try {
    return await db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, params.bookingId))
        .limit(1);

      if (!booking) throw new Error('BOOKING_NOT_FOUND');

      const [ride] = await tx
        .select()
        .from(rides)
        .where(eq(rides.id, booking.rideId))
        .limit(1);

      if (!ride) throw new Error('RIDE_NOT_FOUND');

      const isProvider = ride.providerUserId === params.actorUserId;
      const isPassenger = booking.passengerUserId === params.actorUserId;
      if (!isProvider && !isPassenger) throw new Error('FORBIDDEN');

      if (params.action === 'accept') {
        if (!isProvider) throw new Error('FORBIDDEN');
        if (booking.status !== 'pending') throw new Error('INVALID_STATE');

        const updatedRides = await tx
          .update(rides)
          .set({
            availableSeats: sql`${rides.availableSeats} - ${booking.seatsRequested}`,
          })
          .where(
            and(
              eq(rides.id, ride.id),
              gte(rides.availableSeats, booking.seatsRequested)
            )
          )
          .returning();

        if (updatedRides.length === 0) {
          throw new Error('INSUFFICIENT_SEATS');
        }

        const updatedRide = updatedRides[0];
        const recalculated = calculateDailyCostSplit({
          estimatedTotalCost: updatedRide.estimatedTotalCost,
          totalSeatsOffered: updatedRide.totalSeatsOffered,
          availableSeats: updatedRide.availableSeats,
          costMethod: updatedRide.costMethod,
          includeDriverInSplit: updatedRide.includeDriverInSplit,
        });

        const [updatedBooking] = await tx
          .update(bookings)
          .set({
            status: 'accepted',
            agreedContribution: recalculated.currentPerPerson * booking.seatsRequested,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id))
          .returning();

        await tx.insert(notifications).values({
          userId: booking.passengerUserId,
          type: 'booking_accepted',
          title: 'Seat request accepted',
          body: `Your seat for ${ride.originCity} → ${ride.destinationCity} (${ride.travelDate}) is confirmed. Agreed cash share: PKR ${updatedBooking.agreedContribution}.`,
          relatedRideId: ride.id,
        });

        return updatedBooking;
      }

      if (params.action === 'reject') {
        if (!isProvider) throw new Error('FORBIDDEN');
        if (booking.status !== 'pending') throw new Error('INVALID_STATE');

        const [updatedBooking] = await tx
          .update(bookings)
          .set({ status: 'rejected', updatedAt: new Date() })
          .where(eq(bookings.id, booking.id))
          .returning();

        await tx.insert(notifications).values({
          userId: booking.passengerUserId,
          type: 'booking_rejected',
          title: 'Seat request declined',
          body: `Your request for ${ride.originCity} → ${ride.destinationCity} (${ride.travelDate}) was declined.`,
          relatedRideId: ride.id,
        });

        return updatedBooking;
      }

      if (params.action === 'cancel') {
        if (!['pending', 'accepted'].includes(booking.status)) {
          throw new Error('INVALID_STATE');
        }

        if (booking.status === 'accepted') {
          await tx
            .update(rides)
            .set({
              availableSeats: sql`LEAST(${rides.totalSeatsOffered}, ${rides.availableSeats} + ${booking.seatsRequested})`,
            })
            .where(eq(rides.id, ride.id));
        }

        await tx
          .update(users)
          .set({
            cancellationCount: sql`${users.cancellationCount} + 1`,
          })
          .where(eq(users.id, params.actorUserId));

        await tx
          .update(liveLocations)
          .set({ isSharing: false, updatedAt: new Date() })
          .where(
            and(
              eq(liveLocations.rideId, ride.id),
              eq(liveLocations.userId, booking.passengerUserId)
            )
          );

        const [updatedBooking] = await tx
          .update(bookings)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(bookings.id, booking.id))
          .returning();

        const notifyUserId = isPassenger ? ride.providerUserId : booking.passengerUserId;
        await tx.insert(notifications).values({
          userId: notifyUserId,
          type: 'booking_cancelled',
          title: 'Booking cancelled',
          body: `A booking for ${ride.originCity} → ${ride.destinationCity} on ${ride.travelDate} was cancelled.`,
          relatedRideId: ride.id,
        });

        return updatedBooking;
      }

      if (params.action === 'no_show') {
        if (!isProvider) throw new Error('FORBIDDEN');
        if (booking.status !== 'accepted') throw new Error('INVALID_STATE');

        const [updatedBooking] = await tx
          .update(bookings)
          .set({
            status: 'no_show',
            cashConfirmed: false,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id))
          .returning();

        await tx.insert(notifications).values({
          userId: booking.passengerUserId,
          type: 'ride_updated',
          title: 'Booking marked as no-show',
          body: `Your booking on ${ride.travelDate} was marked no-show.`,
          relatedRideId: ride.id,
        });

        return updatedBooking;
      }

      if (params.action === 'complete') {
        if (booking.status !== 'accepted') throw new Error('INVALID_STATE');

        const [updatedBooking] = await tx
          .update(bookings)
          .set({
            status: 'completed',
            cashConfirmed: true,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id))
          .returning();

        await tx
          .update(liveLocations)
          .set({ isSharing: false, updatedAt: new Date() })
          .where(
            and(
              eq(liveLocations.rideId, ride.id),
              eq(liveLocations.userId, booking.passengerUserId)
            )
          );

        if (isProvider) {
          await tx.insert(notifications).values({
            userId: booking.passengerUserId,
            type: 'ride_completed',
            title: 'Ride finished. Rate your driver',
            body: `Your ${ride.originCity} → ${ride.destinationCity} trip is done. Leave a rating and short note for your driver.`,
            relatedRideId: ride.id,
          });
        } else {
          await tx.insert(notifications).values({
            userId: ride.providerUserId,
            type: 'ride_completed',
            title: 'Passenger marked trip completed',
            body: `A passenger finished their ${ride.originCity} → ${ride.destinationCity} (${ride.travelDate}) trip.`,
            relatedRideId: ride.id,
          });
        }

        return updatedBooking;
      }

      throw new Error('INVALID_ACTION');
    });
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'BOOKING_NOT_FOUND',
        'RIDE_NOT_FOUND',
        'FORBIDDEN',
        'INVALID_STATE',
        'INSUFFICIENT_SEATS',
        'INVALID_ACTION',
      ].includes(error.message)
    ) {
      throw error;
    }
    console.error('Database query failed in decideBookingTransactional:', error);
    throw new Error('Failed to update booking state.', { cause: error });
  }
}

export async function getAdminOverview() {
  try {
    await ensureSeeded();

    const [
      allUsers,
      allVehicles,
      allServices,
      allRides,
      allBookings,
      allReports,
      allRoutes,
      allCampuses,
      allAuditLogs,
      allVerificationRecords,
    ] = await Promise.all([
      db.select().from(users).orderBy(desc(users.createdAt)),
      db.select().from(vehicles).orderBy(desc(vehicles.createdAt)),
      db.select().from(transportServices).orderBy(desc(transportServices.createdAt)),
      db.select().from(rides).orderBy(desc(rides.travelDate)),
      db.select().from(bookings).orderBy(desc(bookings.createdAt)),
      db.select().from(reports).orderBy(desc(reports.createdAt)),
      db.select().from(routes).orderBy(asc(routes.id)),
      db.select().from(campuses).orderBy(asc(campuses.id)),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(50),
      db
        .select()
        .from(verificationRecords)
        .orderBy(desc(verificationRecords.createdAt))
        .limit(100),
    ]);

    const userLookup = new Map(allUsers.map((u) => [u.id, u]));
    const enrichedRecords = allVerificationRecords.map((rec) => {
      const owner = userLookup.get(rec.userId);
      const reviewer = rec.reviewedByAdminId
        ? userLookup.get(rec.reviewedByAdminId)
        : null;
      return {
        ...rec,
        userName: owner?.fullName ?? 'Student',
        userEmail: owner?.email ?? '',
        rollNumber: owner?.rollNumber ?? null,
        reviewerName: reviewer?.fullName ?? null,
      };
    });

    const enrichedVehicles = allVehicles.map((v) => {
      const owner = userLookup.get(v.ownerUserId);
      return {
        ...v,
        ownerName: owner?.fullName ?? v.driverName,
        ownerEmail: owner?.email ?? '',
        cnicNumber: v.cnicNumber || owner?.cnicNumber || null,
        cnicImageUrl: v.cnicImageUrl || owner?.cnicImageUrl || null,
        ownerCnicStatus: owner?.cnicVerificationStatus ?? 'unsubmitted',
      };
    });

    const enrichedServices = allServices.map((s) => {
      const owner = userLookup.get(s.coordinatorUserId);
      return {
        ...s,
        ownerName: owner?.fullName ?? s.driverName,
        ownerEmail: owner?.email ?? '',
        cnicNumber: s.cnicNumber || owner?.cnicNumber || null,
        cnicImageUrl: s.cnicImageUrl || owner?.cnicImageUrl || null,
        ownerCnicStatus: owner?.cnicVerificationStatus ?? 'unsubmitted',
      };
    });

    const stats = {
      totalStudents: allUsers.length,
      verifiedStudents: allUsers.filter((u) => u.verificationStatus === 'verified').length,
      pendingVerifications:
        allUsers.filter(
          (u) =>
            u.verificationStatus === 'pending' ||
            u.cnicVerificationStatus === 'pending' ||
            u.studentCardStatus === 'pending'
        ).length +
        allVehicles.filter((v) => v.verificationStatus === 'pending').length +
        allServices.filter((s) => s.verificationStatus === 'pending').length,
      registeredVehicles: allVehicles.length,
      registeredServices: allServices.length,
      activeRides: allRides.filter((r) => r.status === 'scheduled').length,
      confirmedBookings: allBookings.filter((b) =>
        ['accepted', 'completed'].includes(b.status)
      ).length,
      openReports: allReports.filter((r) =>
        ['open', 'investigating'].includes(r.status)
      ).length,
    };

    return {
      stats,
      users: allUsers,
      vehicles: enrichedVehicles,
      transportServices: enrichedServices,
      rides: allRides,
      bookings: allBookings,
      reports: allReports,
      routes: allRoutes,
      campuses: allCampuses,
      auditLogs: allAuditLogs,
      verificationRecords: enrichedRecords,
    };
  } catch (error) {
    console.error('Database query failed in getAdminOverview:', error);
    throw new Error('Failed to load admin console data.', { cause: error });
  }
}

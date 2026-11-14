import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. Universities (extensible multi-university hierarchy)
export const universities = pgTable('universities', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  shortCode: text('short_code').notNull().unique(),
  emailDomain: text('email_domain').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Campuses
export const campuses = pgTable('campuses', {
  id: serial('id').primaryKey(),
  universityId: integer('university_id')
    .references(() => universities.id)
    .notNull(),
  name: text('name').notNull(),
  city: text('city').notNull(),
  address: text('address').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. Users & Student Profiles
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  avatarUrl: text('avatar_url'),
  nuEmail: text('nu_email'),
  rollNumber: text('roll_number'),
  phone: text('phone'),
  universityId: integer('university_id').references(() => universities.id),
  campusId: integer('campus_id').references(() => campuses.id),
  department: text('department'),
  semester: text('semester'),
  homeArea: text('home_area'),
  preferredDeparture: text('preferred_departure'),
  preferredReturn: text('preferred_return'),
  studentIdNote: text('student_id_note'),
  verificationStatus: text('verification_status').default('pending').notNull(), // 'pending' | 'verified' | 'rejected' | 'suspended'
  cnicNumber: text('cnic_number'),
  cnicImageUrl: text('cnic_image_url'),
  cnicVerificationStatus: text('cnic_verification_status').default('unsubmitted').notNull(), // 'unsubmitted' | 'pending' | 'verified' | 'rejected'
  studentCardImageUrl: text('student_card_image_url'),
  studentCardStatus: text('student_card_status').default('unsubmitted').notNull(), // 'unsubmitted' | 'pending' | 'verified' | 'rejected'
  verificationReviewNote: text('verification_review_note'),
  isDriver: boolean('is_driver').default(false).notNull(),
  isCoordinator: boolean('is_coordinator').default(false).notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }).default('5.00').notNull(),
  ratingCount: integer('rating_count').default(0).notNull(),
  cancellationCount: integer('cancellation_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 4. Personal Vehicles (distinct driver fields from student owner)
export const vehicles = pgTable('vehicles', {
  id: serial('id').primaryKey(),
  ownerUserId: integer('owner_user_id')
    .references(() => users.id)
    .notNull(),
  category: text('category').notNull(), // 'car' | 'motorcycle'
  makeModel: text('make_model').notNull(),
  registrationNumber: text('registration_number').notNull(),
  color: text('color').notNull(),
  capacity: integer('capacity').notNull(),
  driverName: text('driver_name').notNull(),
  driverPhone: text('driver_phone').notNull(),
  isSelfDriven: boolean('is_self_driven').default(true).notNull(),
  cnicNumber: text('cnic_number'),
  cnicImageUrl: text('cnic_image_url'),
  verificationStatus: text('verification_status').default('pending').notNull(), // 'pending' | 'verified' | 'rejected'
  reviewedByAdminId: integer('reviewed_by_admin_id'),
  reviewedAt: timestamp('reviewed_at'),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 5. Existing Transport Services / Carry Arrangements
export const transportServices = pgTable('transport_services', {
  id: serial('id').primaryKey(),
  coordinatorUserId: integer('coordinator_user_id')
    .references(() => users.id)
    .notNull(),
  serviceName: text('service_name').notNull(),
  serviceType: text('service_type').notNull(), // 'carry' | 'van' | 'private_driver'
  vehicleModel: text('vehicle_model').notNull(),
  registrationNumber: text('registration_number').notNull(),
  capacity: integer('capacity').notNull(),
  driverName: text('driver_name').notNull(),
  driverPhone: text('driver_phone').notNull(),
  authorizationNote: text('authorization_note').notNull(),
  cnicNumber: text('cnic_number'),
  cnicImageUrl: text('cnic_image_url'),
  verificationStatus: text('verification_status').default('pending').notNull(), // 'pending' | 'verified' | 'rejected'
  reviewedByAdminId: integer('reviewed_by_admin_id'),
  reviewedAt: timestamp('reviewed_at'),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Routes (not hardcoded to Chiniot ↔ Faisalabad)
export const routes = pgTable('routes', {
  id: serial('id').primaryKey(),
  campusId: integer('campus_id')
    .references(() => campuses.id)
    .notNull(),
  originCity: text('origin_city').notNull(),
  destinationCity: text('destination_city').notNull(),
  corridorLabel: text('corridor_label').notNull(),
  distanceKm: integer('distance_km').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 7. Recurring Ride Schedules
export const rideSchedules = pgTable('ride_schedules', {
  id: serial('id').primaryKey(),
  providerUserId: integer('provider_user_id')
    .references(() => users.id)
    .notNull(),
  routeId: integer('route_id')
    .references(() => routes.id)
    .notNull(),
  vehicleId: integer('vehicle_id').references(() => vehicles.id),
  transportServiceId: integer('transport_service_id').references(() => transportServices.id),
  originArea: text('origin_area').notNull(),
  destinationArea: text('destination_area').notNull(),
  pickupPoints: text('pickup_points').notNull(),
  departureTime: text('departure_time').notNull(), // HH:mm
  returnTime: text('return_time'),
  journeyType: text('journey_type').notNull(), // 'morning' | 'evening' | 'round_trip'
  weekdays: text('weekdays').notNull(), // comma-separated e.g. 'Mon,Tue,Wed,Thu,Fri'
  offeredSeats: integer('offered_seats').notNull(),
  estimatedTotalCost: integer('estimated_total_cost').notNull(),
  costMethod: text('cost_method').default('equal_split').notNull(), // 'equal_split' | 'fixed_per_seat'
  includeDriverInSplit: boolean('include_driver_in_split').default(false).notNull(),
  challanSplitEnabled: boolean('challan_split_enabled').default(true).notNull(),
  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 8. Individual Ride Occurrences
export const rides = pgTable('rides', {
  id: serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => rideSchedules.id),
  providerUserId: integer('provider_user_id')
    .references(() => users.id)
    .notNull(),
  routeId: integer('route_id')
    .references(() => routes.id)
    .notNull(),
  vehicleId: integer('vehicle_id').references(() => vehicles.id),
  transportServiceId: integer('transport_service_id').references(() => transportServices.id),
  originCity: text('origin_city').notNull(),
  originArea: text('origin_area').notNull(),
  destinationCity: text('destination_city').notNull(),
  destinationArea: text('destination_area').notNull(),
  pickupPoints: text('pickup_points').notNull(),
  travelDate: text('travel_date').notNull(), // YYYY-MM-DD
  departureTime: text('departure_time').notNull(), // HH:mm
  returnTime: text('return_time'),
  journeyType: text('journey_type').notNull(), // 'morning' | 'evening' | 'round_trip'
  totalSeatsOffered: integer('total_seats_offered').notNull(),
  availableSeats: integer('available_seats').notNull(),
  estimatedTotalCost: integer('estimated_total_cost').notNull(),
  costMethod: text('cost_method').default('equal_split').notNull(),
  includeDriverInSplit: boolean('include_driver_in_split').default(false).notNull(),
  challanSplitEnabled: boolean('challan_split_enabled').default(true).notNull(),
  notes: text('notes'),
  status: text('status').default('scheduled').notNull(), // 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 9. Bookings & Seat Requests
export const bookings = pgTable('bookings', {
  id: serial('id').primaryKey(),
  rideId: integer('ride_id')
    .references(() => rides.id)
    .notNull(),
  passengerUserId: integer('passenger_user_id')
    .references(() => users.id)
    .notNull(),
  seatsRequested: integer('seats_requested').default(1).notNull(),
  pickupPoint: text('pickup_point').notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed' | 'no_show'
  agreedContribution: integer('agreed_contribution').notNull(),
  cashConfirmed: boolean('cash_confirmed').default(false).notNull(),
  passengerNote: text('passenger_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 10. Student Timetable Slots & Uploaded Schedule Meta
export const timetableSlots = pgTable('timetable_slots', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  dayOfWeek: text('day_of_week').notNull(), // 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'
  courseName: text('course_name'),
  room: text('room'),
  classStartTime: text('class_start_time').notNull(), // HH:mm
  classEndTime: text('class_end_time').notNull(), // HH:mm
  campusName: text('campus_name').default('FAST-NUCES Chiniot Campus').notNull(),
  breakPeriod: text('break_period'),
  uploadedFileName: text('uploaded_file_name'),
  uploadedFileType: text('uploaded_file_type'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 11. In-App Messages
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  rideId: integer('ride_id')
    .references(() => rides.id)
    .notNull(),
  senderUserId: integer('sender_user_id')
    .references(() => users.id)
    .notNull(),
  receiverUserId: integer('receiver_user_id')
    .references(() => users.id)
    .notNull(),
  content: text('content').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 12. Notifications
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  relatedRideId: integer('related_ride_id'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 13. Reviews & Ratings
export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  bookingId: integer('booking_id')
    .references(() => bookings.id)
    .notNull()
    .unique(),
  rideId: integer('ride_id')
    .references(() => rides.id)
    .notNull(),
  reviewerUserId: integer('reviewer_user_id')
    .references(() => users.id)
    .notNull(),
  revieweeUserId: integer('reviewee_user_id')
    .references(() => users.id)
    .notNull(),
  overallRating: integer('overall_rating').notNull(),
  punctualityRating: integer('punctuality_rating').notNull(),
  communicationRating: integer('communication_rating').notNull(),
  experienceRating: integer('experience_rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 14. Safety & Misconduct Reports
export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  reporterUserId: integer('reporter_user_id')
    .references(() => users.id)
    .notNull(),
  reportedUserId: integer('reported_user_id').references(() => users.id),
  rideId: integer('ride_id').references(() => rides.id),
  category: text('category').notNull(),
  description: text('description').notNull(),
  status: text('status').default('open').notNull(), // 'open' | 'investigating' | 'resolved' | 'dismissed'
  adminNotes: text('admin_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 15. Administrative Audit Logs
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  adminUserId: integer('admin_user_id')
    .references(() => users.id)
    .notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: integer('target_id').notNull(),
  details: text('details').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 16. Message Emoji Reactions
export const messageReactions = pgTable('message_reactions', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id')
    .references(() => messages.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 17. Real-Time Ride Location Sharing
export const liveLocations = pgTable('live_locations', {
  id: serial('id').primaryKey(),
  rideId: integer('ride_id')
    .references(() => rides.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').default('passenger').notNull(), // 'passenger' | 'driver'
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  note: text('note'),
  isSharing: boolean('is_sharing').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 18. Traffic Challans (divided equally among everyone in the car)
export const rideChallans = pgTable('ride_challans', {
  id: serial('id').primaryKey(),
  rideId: integer('ride_id')
    .references(() => rides.id, { onDelete: 'cascade' })
    .notNull(),
  reportedByUserId: integer('reported_by_user_id')
    .references(() => users.id)
    .notNull(),
  title: text('title').notNull(),
  amount: integer('amount').notNull(),
  locationNote: text('location_note'),
  includeDriver: boolean('include_driver').default(true).notNull(),
  headcount: integer('headcount').notNull(),
  perPersonShare: integer('per_person_share').notNull(),
  status: text('status').default('active').notNull(), // 'active' | 'settled'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 19. Permanent Document & Verification Records (recorded for risk & abnormality auditing)
export const verificationRecords = pgTable('verification_records', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  documentType: text('document_type').notNull(), // 'student_card' | 'cnic_driver' | 'vehicle_registration' | 'carry_service'
  referenceNumber: text('reference_number'),
  documentImageUrl: text('document_image_url'),
  status: text('status').default('pending').notNull(), // 'pending' | 'verified' | 'rejected'
  relatedVehicleId: integer('related_vehicle_id'),
  relatedServiceId: integer('related_service_id'),
  reviewedByAdminId: integer('reviewed_by_admin_id'),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at'),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  university: one(universities, {
    fields: [users.universityId],
    references: [universities.id],
  }),
  campus: one(campuses, {
    fields: [users.campusId],
    references: [campuses.id],
  }),
  vehicles: many(vehicles),
  transportServices: many(transportServices),
  ridesOffered: many(rides),
  bookings: many(bookings),
  timetableSlots: many(timetableSlots),
}));

export const ridesRelations = relations(rides, ({ one, many }) => ({
  provider: one(users, {
    fields: [rides.providerUserId],
    references: [users.id],
  }),
  route: one(routes, {
    fields: [rides.routeId],
    references: [routes.id],
  }),
  vehicle: one(vehicles, {
    fields: [rides.vehicleId],
    references: [vehicles.id],
  }),
  transportService: one(transportServices, {
    fields: [rides.transportServiceId],
    references: [transportServices.id],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  ride: one(rides, {
    fields: [bookings.rideId],
    references: [rides.id],
  }),
  passenger: one(users, {
    fields: [bookings.passengerUserId],
    references: [users.id],
  }),
}));

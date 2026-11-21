import type { CostSplitResult } from './lib/matching';

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  nuEmail: string | null;
  rollNumber: string | null;
  phone: string | null;
  universityId: number | null;
  campusId: number | null;
  department: string | null;
  semester: string | null;
  homeArea: string | null;
  preferredDeparture: string | null;
  preferredReturn: string | null;
  studentIdNote: string | null;
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'suspended';
  cnicNumber?: string | null;
  cnicImageUrl?: string | null;
  cnicVerificationStatus: 'unsubmitted' | 'pending' | 'verified' | 'rejected';
  studentCardImageUrl?: string | null;
  studentCardStatus: 'unsubmitted' | 'pending' | 'verified' | 'rejected';
  verificationReviewNote?: string | null;
  isDriver: boolean;
  isCoordinator: boolean;
  isAdmin: boolean;
  isSuperAdmin?: boolean;
  ratingAvg: string;
  ratingCount: number;
  cancellationCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RouteItem {
  id: number;
  campusId: number;
  originCity: string;
  destinationCity: string;
  corridorLabel: string;
  distanceKm: number;
  isActive: boolean;
}

export interface VehicleItem {
  id: number;
  ownerUserId: number;
  ownerName?: string;
  ownerEmail?: string;
  ownerCnicStatus?: 'unsubmitted' | 'pending' | 'verified' | 'rejected';
  category: 'car' | 'motorcycle';
  makeModel: string;
  registrationNumber: string;
  color: string;
  capacity: number;
  driverName: string;
  driverPhone: string;
  isSelfDriven: boolean;
  cnicNumber?: string | null;
  cnicImageUrl?: string | null;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  reviewedByAdminId?: number | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

export interface TransportServiceItem {
  id: number;
  coordinatorUserId: number;
  ownerName?: string;
  ownerEmail?: string;
  ownerCnicStatus?: 'unsubmitted' | 'pending' | 'verified' | 'rejected';
  serviceName: string;
  serviceType: 'carry' | 'van' | 'private_driver';
  vehicleModel: string;
  registrationNumber: string;
  capacity: number;
  driverName: string;
  driverPhone: string;
  authorizationNote: string;
  cnicNumber?: string | null;
  cnicImageUrl?: string | null;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  reviewedByAdminId?: number | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

export interface SosAlertItem {
  id: number;
  rideId: number;
  triggeredByUserId: number;
  triggeredByName: string;
  triggeredByAvatarUrl: string | null;
  triggeredByRollNumber: string | null;
  triggeredByPhone: string | null;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  message: string | null;
  status: 'active' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}

export interface VerificationRecordItem {
  id: number;
  userId: number;
  userName?: string;
  userEmail?: string;
  rollNumber?: string | null;
  reviewerName?: string | null;
  documentType: 'student_card' | 'cnic_driver' | 'vehicle_registration' | 'carry_service';
  referenceNumber: string | null;
  documentImageUrl: string | null;
  status: 'pending' | 'verified' | 'rejected';
  relatedVehicleId: number | null;
  relatedServiceId: number | null;
  reviewedByAdminId: number | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ProviderReviewItem {
  id: number;
  rideId: number;
  reviewerName: string;
  reviewerAvatarUrl: string | null;
  overallRating: number;
  punctualityRating: number;
  communicationRating: number;
  experienceRating: number;
  comment: string | null;
  createdAt: string;
}

export interface RideChallanItem {
  id: number;
  rideId: number;
  reportedByUserId: number;
  reportedByName?: string;
  title: string;
  amount: number;
  locationNote: string | null;
  includeDriver: boolean;
  headcount: number;
  perPersonShare: number;
  status: 'active' | 'settled';
  createdAt: string;
}

export interface RideItem {
  id: number;
  scheduleId: number | null;
  providerUserId: number;
  routeId: number;
  vehicleId: number | null;
  transportServiceId: number | null;
  originCity: string;
  originArea: string;
  destinationCity: string;
  destinationArea: string;
  pickupPoints: string;
  travelDate: string;
  departureTime: string;
  returnTime: string | null;
  journeyType: 'morning' | 'evening' | 'round_trip';
  totalSeatsOffered: number;
  availableSeats: number;
  estimatedTotalCost: number;
  costMethod: string;
  includeDriverInSplit: boolean;
  challanSplitEnabled?: boolean;
  notes: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  provider: {
    id: number;
    fullName: string;
    avatarUrl: string | null;
    department: string | null;
    semester: string | null;
    homeArea: string | null;
    verificationStatus: string;
    cnicVerified?: boolean;
    studentCardVerified?: boolean;
    ratingAvg: string;
    ratingCount: number;
    isDriver: boolean;
    isCoordinator: boolean;
  } | null;
  providerReviews?: ProviderReviewItem[];
  vehicle: {
    id: number;
    category: string;
    makeModel: string;
    color: string;
    capacity: number;
    isSelfDriven: boolean;
    driverName: string;
    verificationStatus: string;
  } | null;
  transportService: {
    id: number;
    serviceName: string;
    serviceType: string;
    vehicleModel: string;
    capacity: number;
    driverName: string;
    verificationStatus: string;
  } | null;
  costSplit: CostSplitResult;
  challans?: RideChallanItem[];
  challanPerPersonTotal?: number;
}

export interface RideRequestItem {
  id: number;
  passengerUserId: number;
  routeId: number;
  originCity: string;
  originArea: string;
  destinationCity: string;
  destinationArea: string;
  pickupPoint: string;
  travelDate: string;
  preferredTime: string;
  returnTime: string | null;
  journeyType: 'morning' | 'evening' | 'round_trip';
  seatsNeeded: number;
  maxBudgetPerSeat: number;
  notes: string | null;
  status: 'open' | 'matched' | 'cancelled';
  matchedDriverUserId: number | null;
  matchedRideId: number | null;
  matchedBookingId: number | null;
  createdAt: string;
  passenger: {
    id: number;
    fullName: string;
    avatarUrl: string | null;
    department: string | null;
    semester: string | null;
    homeArea: string | null;
    verificationStatus: string;
    studentCardVerified?: boolean;
    ratingAvg: string;
    ratingCount: number;
  } | null;
  matchedDriver?: {
    id: number;
    fullName: string;
    avatarUrl: string | null;
    department: string | null;
    ratingAvg: string;
    phone: string | null;
  } | null;
}

export interface BookingItem {
  id: number;
  rideId: number;
  passengerUserId: number;
  seatsRequested: number;
  pickupPoint: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed' | 'no_show';
  agreedContribution: number;
  cashConfirmed: boolean;
  passengerNote: string | null;
  createdAt: string;
  hasReviewed?: boolean;
  myReview?: {
    id: number;
    overallRating: number;
    punctualityRating: number;
    communicationRating: number;
    experienceRating: number;
    comment: string | null;
    createdAt: string;
  } | null;
  ride: RideItem | null;
  provider?: {
    id: number;
    fullName: string;
    avatarUrl: string | null;
    department: string | null;
    ratingAvg: string;
    phone: string | null;
  } | null;
  passenger?: {
    id: number;
    fullName: string;
    avatarUrl: string | null;
    department: string | null;
    semester: string | null;
    homeArea: string | null;
    verificationStatus: string;
    ratingAvg: string;
    phone: string | null;
  } | null;
}

export interface TimetableSlot {
  id?: number;
  dayOfWeek: string;
  courseName?: string | null;
  room?: string | null;
  classStartTime: string;
  classEndTime: string;
  campusName: string;
  breakPeriod?: string | null;
  uploadedFileName?: string | null;
  uploadedFileType?: string | null;
}

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  userReacted: boolean;
}

export interface MessageItem {
  id: number;
  rideId: number;
  senderUserId: number;
  receiverUserId: number;
  content: string;
  isRead: boolean;
  createdAt: string;
  senderName: string;
  senderAvatarUrl?: string | null;
  receiverName: string;
  receiverAvatarUrl?: string | null;
  rideLabel: string;
  reactions: MessageReactionSummary[];
}

export interface LiveLocationPoint {
  id: number;
  rideId: number;
  userId: number;
  fullName: string;
  avatarUrl: string | null;
  role: 'passenger' | 'driver';
  lat: number;
  lng: number;
  note: string | null;
  isSharing: boolean;
  updatedAt: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  relatedRideId: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface UserWorkspace {
  vehicles: VehicleItem[];
  transportServices: TransportServiceItem[];
  myBookings: BookingItem[];
  myRideRequests: RideRequestItem[];
  providerRides: RideItem[];
  incomingBookings: BookingItem[];
  timetable: TimetableSlot[];
  notifications: NotificationItem[];
  messages: MessageItem[];
  receivedReviews?: (ProviderReviewItem & { rideLabel?: string })[];
}

export interface PublicCatalog {
  universities: { id: number; name: string; shortCode: string }[];
  campuses: { id: number; name: string; city: string; address: string }[];
  routes: RouteItem[];
  rides: RideItem[];
  rideRequests: RideRequestItem[];
}

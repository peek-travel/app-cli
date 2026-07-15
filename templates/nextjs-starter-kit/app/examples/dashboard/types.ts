export interface DashboardStats {
  activitiesCount: number;
  todayBookings: { count: number; canceledCount: number };
  weekBookings: { count: number; revenue: string };
}

export interface RecentBooking {
  bookingId: string;
  displayId: string;
  customerName: string | null;
  productName: string;
  startsAt: string | null;
  purchasedAt: string | null;
  totalTickets: number;
  ticketDescription: string;
  valueDisplay: string;
  isCanceled: boolean;
  isCheckedIn: boolean;
  source: string;
}

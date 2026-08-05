/**
 * useMapData — fetches the Live Map payload (GET /api/map/data) that also
 * powers the dispatcher web portal's map. Available to every linked staff
 * member (guardStaff on the server).
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { customFetch } from '@workspace/api-client-react';
import { useStaff } from '@/context/StaffContext';

export interface MapPosition {
  lat: number;
  lng: number;
  source: 'live' | 'home';
}

export interface MapStaffMember {
  id: number;
  name: string;
  role: string;
  liveLocation: { lat: number; lng: number; updatedAt: string } | null;
  /** Position for the requested date (live fix only when viewing today). */
  position: MapPosition | null;
  /** Freshest known position regardless of the calendar date. */
  currentPosition: MapPosition | null;
}

export interface MapBooking {
  id: number;
  firstName: string;
  lastName: string;
  address: string;
  city: string | null;
  addressLat: number | null;
  addressLng: number | null;
  scheduledDate: string;
  scheduledTime: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  serviceType: string | null;
  staffId: number | null;
}

export interface MapData {
  staff: MapStaffMember[];
  bookings: MapBooking[];
  isToday: boolean;
  callerRole: 'dispatcher' | 'cleaner';
}

export function useMapData(date: string) {
  // Scope the cache to the signed-in Clerk user so an account switch on a
  // shared device can never surface the previous user's cached map data,
  // and wait until the staff link is settled (guardStaff would 403 anyway).
  const { userId } = useAuth();
  const { staffId, isLoaded: staffLoaded } = useStaff();

  return useQuery<MapData>({
    queryKey: ['map-data', userId, date],
    queryFn: () =>
      customFetch<MapData>(`/api/map/data?date=${encodeURIComponent(date)}`, {
        responseType: 'json',
      }),
    enabled: !!userId && staffLoaded && staffId !== null,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

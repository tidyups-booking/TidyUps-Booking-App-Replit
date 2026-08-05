import type { MapBooking, MapStaffMember } from '@/hooks/useMapData';

export type JobPin = MapBooking & { addressLat: number; addressLng: number };

export interface JobMapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface JobMapProps {
  jobPins: JobPin[];
  staffPins: MapStaffMember[];
  staffNameById: Map<number, string>;
  /** The caller's own staff id (to label "You"). */
  ownStaffId: number | null;
  initialRegion: JobMapRegion;
  onOpenJob: (id: number) => void;
  statusColors: Record<MapBooking['status'], string>;
  statusLabel: (status: MapBooking['status']) => string;
}

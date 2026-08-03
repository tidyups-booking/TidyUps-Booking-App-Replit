import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { usePostStaffLocation } from '@workspace/api-client-react';
import { useStaff } from '@/context/StaffContext';

type LocationStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';

interface LocationContextValue {
  status: LocationStatus;
  lastUpdate: Date | null;
  requestPermission: () => Promise<void>;
}

const LocationContext = createContext<LocationContextValue>({
  status: 'idle',
  lastUpdate: null,
  requestPermission: async () => {},
});

/** Share GPS only 8 AM–8 PM local time */
function isWithinWorkHours(): boolean {
  const h = new Date().getHours();
  return h >= 8 && h < 20;
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const { staffId } = useStaff();
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  // Store a ref to the current staffId used for posting so we don't close over
  // a stale value inside the interval callback.
  const staffIdRef = useRef(staffId);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { mutate: postLocation } = usePostStaffLocation();

  // Keep the ref in sync with the current staffId
  useEffect(() => {
    staffIdRef.current = staffId;
  }, [staffId]);

  const postCurrentLocation = async () => {
    const currentStaffId = staffIdRef.current;
    if (!currentStaffId || !isWithinWorkHours()) return;

    if (Platform.OS !== 'web') {
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        postLocation(
          {
            id: currentStaffId,
            data: {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              accuracy: loc.coords.accuracy ?? undefined,
            },
          },
          { onSuccess: () => setLastUpdate(new Date()) },
        );
      } catch (e) {
        console.warn('[Location] Failed to get position:', e);
      }
    } else {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => {
        postLocation(
          {
            id: currentStaffId,
            data: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            },
          },
          { onSuccess: () => setLastUpdate(new Date()) },
        );
      });
    }
  };

  const requestPermission = async () => {
    setStatus('requesting');
    try {
      if (Platform.OS !== 'web') {
        const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
        if (permStatus !== 'granted') {
          setStatus('denied');
          return;
        }
      } else {
        if (!navigator.geolocation) {
          setStatus('unavailable');
          return;
        }
      }
      setStatus('active');
    } catch {
      setStatus('unavailable');
    }
  };

  // When staffId is first set (after /staff/me resolves), auto-check permission
  useEffect(() => {
    if (!staffId) {
      // staffId was cleared — stop sharing
      setStatus('idle');
      return;
    }
    (async () => {
      if (Platform.OS !== 'web') {
        const { status: existing } = await Location.getForegroundPermissionsAsync();
        if (existing === 'granted') {
          setStatus('active');
        } else {
          await requestPermission();
        }
      } else {
        setStatus('active');
      }
    })();
  }, [staffId]); // depend on staffId VALUE so this re-runs when it changes

  // Start/stop the 30-second polling interval when status or staffId changes.
  // Using staffId as a dependency (not !!staffId) ensures the old interval is
  // torn down and a new one started if the linked staff record ever changes.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (status !== 'active' || !staffId) return;

    void postCurrentLocation(); // immediate first post
    intervalRef.current = setInterval(() => { void postCurrentLocation(); }, 30_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status, staffId]); // staffId here (not !!staffId) restarts properly on value change

  return (
    <LocationContext.Provider value={{ status, lastUpdate, requestPermission }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  return useContext(LocationContext);
}

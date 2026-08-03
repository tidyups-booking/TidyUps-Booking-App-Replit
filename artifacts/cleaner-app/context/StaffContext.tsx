/**
 * StaffContext — resolves the authenticated cleaner's staff record from the
 * API server via GET /staff/me (server-side Clerk → staff lookup).
 *
 * No manual staff picker. Linking a Clerk account to a staff record is a
 * dispatcher-only action performed via PATCH /staff/:id { clerkUserId }.
 */
import React, { createContext, useContext, ReactNode } from 'react';
import { useGetStaffMe } from '@workspace/api-client-react';

interface StaffContextValue {
  /** DB primary key of the caller's linked staff record, or null if not linked. */
  staffId: number | null;
  /** Display name of the linked staff record. */
  staffName: string | null;
  /** Phone number on the linked staff record. */
  staffPhone: string | null;
  /** Email address on the linked staff record. */
  staffEmail: string | null;
  /** True once the /staff/me query has settled (success or 404). */
  isLoaded: boolean;
  /** True when a staff record is linked to the caller's Clerk account. */
  isLinked: boolean;
  /** Refetch (e.g. after a dispatcher links the account). */
  refetch: () => void;
}

const StaffContext = createContext<StaffContextValue>({
  staffId: null,
  staffName: null,
  staffPhone: null,
  staffEmail: null,
  isLoaded: false,
  isLinked: false,
  refetch: () => {},
});

export function StaffProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, refetch } = useGetStaffMe({
    query: {
      // 404 is "not linked" — not an error worth retrying aggressively
      retry: false,
      staleTime: 5 * 60 * 1_000,
    } as any,
  });

  return (
    <StaffContext.Provider
      value={{
        staffId: data?.id ?? null,
        staffName: data?.name ?? null,
        staffPhone: (data as any)?.phone ?? null,
        staffEmail: (data as any)?.email ?? null,
        isLoaded: !isLoading,
        isLinked: !!data,
        refetch,
      }}
    >
      {children}
    </StaffContext.Provider>
  );
}

export function useStaff() {
  return useContext(StaffContext);
}

/**
 * StaffContext — resolves the authenticated cleaner's staff record from the
 * API server via GET /staff/me (server-side Clerk → staff lookup).
 *
 * No manual staff picker. Accounts link automatically server-side when the
 * cleaner signs up with the email on their staff record (or a dispatcher can
 * link manually via PATCH /staff/:id { clerkUserId }).
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
      // On a first sign-in the server links the account during the request,
      // but a parallel request can briefly race it. Retry a couple of times
      // with a delay so a just-linked account settles without a manual
      // refresh; then stop (a genuinely unlinked account stays 404).
      retry: 2,
      retryDelay: 2_000,
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

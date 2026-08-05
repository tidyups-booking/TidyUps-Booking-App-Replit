/**
 * useAccountSwitchGuard — single shared defense against leaking the previous
 * user's cached data across a Clerk account switch.
 *
 * The /staff/me cache key is NOT user-scoped, so a cached response could
 * survive an account switch for up to staleTime if sign-out ever skipped
 * queryClient.clear() (e.g. session expiry, sign-out elsewhere). This hook
 * tracks the Clerk userId and, the moment it changes, PURGES the /staff/me
 * entry plus any extra non-user-scoped keys the caller reads (e.g. an
 * ID-keyed booking) BEFORE clearing the change guard — so by the time
 * `userChanged` flips back to false, the entries are gone and the queries
 * refetch under the NEW user's token.
 *
 * Callers must:
 *   - gate their queries with `enabled: !!userId && !userChanged`
 *     (or at minimum `enabled: !!userId`), and
 *   - mask cached data while switching: `userChanged ? undefined : data`.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, QueryKey } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { getGetStaffMeQueryKey } from '@workspace/api-client-react';

export function useAccountSwitchGuard(extraQueryKeys: QueryKey[] = []): {
  userId: string | null | undefined;
  userChanged: boolean;
} {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  // extraQueryKeys is typically a fresh array literal each render; keep the
  // latest value in a ref so the purge effect doesn't need it as a dep.
  const extraKeysRef = useRef(extraQueryKeys);
  extraKeysRef.current = extraQueryKeys;

  const prevUserIdRef = useRef(userId);
  const userChanged = prevUserIdRef.current !== userId;
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      // Purge BEFORE clearing the guard so no render can ever observe the old
      // user's cached data: by the time userChanged flips false, the entries
      // are gone and the hooks are in a fresh loading state.
      queryClient.removeQueries({ queryKey: getGetStaffMeQueryKey() });
      for (const key of extraKeysRef.current) {
        queryClient.removeQueries({ queryKey: key });
      }
      prevUserIdRef.current = userId;
    }
  }, [userId, queryClient]);

  return { userId, userChanged };
}

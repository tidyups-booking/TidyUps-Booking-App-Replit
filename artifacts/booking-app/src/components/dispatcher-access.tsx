import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { ShieldCheck, UserPlus, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

interface Dispatcher {
  clerkUserId: string;
  name: string | null;
  email: string | null;
  imageUrl: string | null;
  createdAt: string;
}

interface ClerkUserOption {
  clerkUserId: string;
  name: string | null;
  email: string | null;
  imageUrl: string | null;
  isDispatcher: boolean;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getBaseUrl()}api${path}`, {
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }
  return res.json();
}

function displayName(u: { name: string | null; email: string | null; clerkUserId: string }) {
  return u.name || u.email || u.clerkUserId;
}

export function DispatcherAccess() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const currentUserId = user?.id;

  const [showAdd, setShowAdd] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");

  const { data: dispatchers = [], isLoading } = useQuery<Dispatcher[]>({
    queryKey: ["dispatchers"],
    queryFn: () => fetchJson<Dispatcher[]>("/dispatchers"),
  });

  const { data: clerkUsers = [], isLoading: usersLoading, error: usersError } = useQuery<
    ClerkUserOption[]
  >({
    queryKey: ["dispatchers", "clerk-users"],
    queryFn: () => fetchJson<ClerkUserOption[]>("/dispatchers/clerk-users"),
    enabled: showAdd,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dispatchers"] });
  };

  const addDispatcher = useMutation({
    mutationFn: (clerkUserId: string) =>
      fetchJson("/dispatchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerkUserId }),
      }),
    onSuccess: () => {
      toast({ title: "Dispatcher added", description: "This user now has dispatcher access." });
      invalidate();
      setShowAdd(false);
      setSelectedUserId("");
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't add dispatcher", description: err.message, variant: "destructive" });
    },
  });

  const removeDispatcher = useMutation({
    mutationFn: (clerkUserId: string) =>
      fetchJson<{ ok: boolean; removedSelf: boolean }>(
        `/dispatchers/${encodeURIComponent(clerkUserId)}`,
        { method: "DELETE" },
      ),
    onSuccess: (result) => {
      toast({ title: "Dispatcher removed", description: "Dispatcher access has been revoked." });
      invalidate();
      if (result.removedSelf) {
        // Caller revoked their own access — reload so the role gate takes effect
        window.location.reload();
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't remove dispatcher",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleRemove = (d: Dispatcher) => {
    const isSelf = d.clerkUserId === currentUserId;
    const who = isSelf ? "your own" : `${displayName(d)}'s`;
    const warning = isSelf
      ? `Remove ${who} dispatcher access? You will immediately lose access to dispatcher pages.`
      : `Remove ${who} dispatcher access?`;
    if (!window.confirm(warning)) return;
    removeDispatcher.mutate(d.clerkUserId);
  };

  const availableUsers = clerkUsers.filter((u) => !u.isDispatcher);
  const lastDispatcher = dispatchers.length <= 1;

  return (
    <Card className="mt-8">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Dispatcher Access
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              People who can log in to this dispatcher app. Cleaners only see their own schedule in
              the mobile app.
            </p>
          </div>
          <Button
            variant={showAdd ? "outline" : "default"}
            size="sm"
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? (
              <>
                <X className="w-4 h-4 mr-1.5" /> Cancel
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-1.5" /> Add Dispatcher
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {showAdd && (
          <div className="rounded-md border border-primary/30 bg-muted/30 p-3 space-y-2">
            <label className="text-sm font-medium">Grant dispatcher access to</label>
            {usersError ? (
              <p className="text-sm text-destructive">
                Couldn't load users: {(usersError as Error).message}
              </p>
            ) : (
              <div className="flex gap-2 flex-col sm:flex-row">
                <NativeSelect
                  className="flex-1"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  disabled={usersLoading}
                >
                  <option value="">
                    {usersLoading
                      ? "Loading users…"
                      : availableUsers.length === 0
                        ? "No other users found"
                        : "Select a user…"}
                  </option>
                  {availableUsers.map((u) => (
                    <option key={u.clerkUserId} value={u.clerkUserId}>
                      {displayName(u)}
                      {u.name && u.email ? ` — ${u.email}` : ""}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  onClick={() => selectedUserId && addDispatcher.mutate(selectedUserId)}
                  disabled={!selectedUserId}
                  isLoading={addDispatcher.isPending}
                >
                  <UserPlus className="w-4 h-4 mr-1.5" />
                  Grant Access
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Users must have signed up for an account before they can be added here.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : dispatchers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dispatchers found.</p>
        ) : (
          <ul className="divide-y">
            {dispatchers.map((d) => {
              const isSelf = d.clerkUserId === currentUserId;
              return (
                <li key={d.clerkUserId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  {d.imageUrl ? (
                    <img
                      src={d.imageUrl}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full brand-gradient text-white text-sm font-bold flex items-center justify-center shrink-0">
                      {(d.name || d.email || "?")
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {displayName(d)}
                      {isSelf && (
                        <Badge variant="outline" className="ml-2 text-xs px-1.5 py-0 align-middle">
                          You
                        </Badge>
                      )}
                    </p>
                    {d.name && d.email && (
                      <p className="text-xs text-muted-foreground truncate">{d.email}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive",
                      lastDispatcher && "opacity-40 cursor-not-allowed",
                    )}
                    disabled={lastDispatcher || removeDispatcher.isPending}
                    title={
                      lastDispatcher
                        ? "Can't remove the last dispatcher — add another one first"
                        : "Remove dispatcher access"
                    }
                    onClick={() => handleRemove(d)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ShieldCheck, UserPlus, Trash2, X, MailPlus, Hourglass } from "lucide-react";
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

interface PendingInvite {
  id: number;
  email: string;
  name: string | null;
  createdAt: string;
}

type AddByEmailResult =
  | { mode: "granted" }
  | { mode: "invited"; invite: PendingInvite };

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
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const { data: dispatchers = [], isLoading } = useQuery<Dispatcher[]>({
    queryKey: ["dispatchers"],
    queryFn: () => fetchJson<Dispatcher[]>("/dispatchers"),
  });

  const { data: invites = [] } = useQuery<PendingInvite[]>({
    queryKey: ["dispatchers", "invites"],
    queryFn: () => fetchJson<PendingInvite[]>("/dispatchers/invites"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dispatchers"] });
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim());

  const addDispatcher = useMutation({
    mutationFn: () =>
      fetchJson<AddByEmailResult>("/dispatchers/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), email: newEmail.trim() }),
      }),
    onSuccess: (result) => {
      if (result.mode === "granted") {
        toast({
          title: "Dispatcher added",
          description: "They already had an account, so they have access right now.",
        });
      } else {
        toast({
          title: "Invite saved",
          description:
            "As soon as they sign up on this site with that email, they'll have dispatcher access automatically.",
        });
      }
      invalidate();
      setShowAdd(false);
      setNewName("");
      setNewEmail("");
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't add dispatcher", description: err.message, variant: "destructive" });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (id: number) =>
      fetchJson<{ ok: boolean }>(`/dispatchers/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Invite removed" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't remove invite", description: err.message, variant: "destructive" });
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
          <form
            className="rounded-md border border-primary/30 bg-muted/30 p-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (emailValid && !addDispatcher.isPending) addDispatcher.mutate();
            }}
          >
            <label className="text-sm font-medium">Add a dispatcher by name and email</label>
            <div className="flex gap-2 flex-col sm:flex-row">
              <Input
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                className="sm:flex-1"
              />
              <Input
                type="email"
                placeholder="Email address"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                maxLength={254}
                className="sm:flex-[1.4]"
              />
              <Button type="submit" disabled={!emailValid} isLoading={addDispatcher.isPending}>
                <UserPlus className="w-4 h-4 mr-1.5" />
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              If they already have an account here, they get access right away. Otherwise they'll
              get dispatcher access automatically the first time they sign up with this email.
            </p>
          </form>
        )}

        {invites.length > 0 && (
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1">
              <Hourglass className="w-3.5 h-3.5" />
              Invited — waiting for them to sign up
            </p>
            <ul className="divide-y">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-2 first:pt-1 last:pb-0">
                  <MailPlus className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{inv.name || inv.email}</p>
                    {inv.name && (
                      <p className="text-xs text-muted-foreground truncate">{inv.email}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    title="Remove this invite"
                    disabled={revokeInvite.isPending}
                    onClick={() => revokeInvite.mutate(inv.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </li>
              ))}
            </ul>
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

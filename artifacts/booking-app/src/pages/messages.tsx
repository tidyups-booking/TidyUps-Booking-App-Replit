import {
  useListContactMessages,
  useUpdateContactMessage,
  useDeleteContactMessage,
  getListContactMessagesQueryKey,
} from "@workspace/api-client-react";
import type { ContactMessage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Inbox, Mail, Phone, Check, Undo2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

function formatReceived(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MessageCard({ message }: { message: ContactMessage }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListContactMessagesQueryKey() });

  const update = useUpdateContactMessage({
    mutation: {
      onSuccess: invalidate,
      onError: () =>
        toast({ title: "Could not update message", variant: "destructive" }),
    },
  });
  const remove = useDeleteContactMessage({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Message deleted" });
      },
      onError: () =>
        toast({ title: "Could not delete message", variant: "destructive" }),
    },
  });

  const isNew = !message.handledAt;

  return (
    <Card
      className={cn(
        "transition-colors",
        isNew ? "border-primary/40 bg-primary/5" : "opacity-80",
      )}
    >
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{message.name}</span>
              {isNew ? (
                <Badge className="bg-primary text-white">New</Badge>
              ) : (
                <Badge variant="secondary">Handled</Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <a
                href={`mailto:${message.email}`}
                className="flex items-center gap-1 hover:text-primary"
              >
                <Mail className="w-3.5 h-3.5" />
                {message.email}
              </a>
              {message.phone && (
                <a
                  href={`tel:${message.phone}`}
                  className="flex items-center gap-1 hover:text-primary"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {message.phone}
                </a>
              )}
            </div>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatReceived(message.createdAt)}
          </span>
        </div>

        <p className="mt-3 text-sm whitespace-pre-wrap break-words">{message.message}</p>

        <div className="mt-4 flex items-center gap-2">
          {isNew ? (
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: message.id, data: { handled: true } })}
            >
              <Check className="w-4 h-4 mr-1" />
              Mark handled
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: message.id, data: { handled: false } })}
            >
              <Undo2 className="w-4 h-4 mr-1" />
              Mark as new
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm("Delete this message? This cannot be undone.")) {
                remove.mutate({ id: message.id });
              }
            }}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MessagesPage() {
  const { data: messages, isLoading, isError } = useListContactMessages();
  const newCount = messages?.filter((m) => !m.handledAt).length ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-serif">Messages</h1>
          <p className="text-sm text-muted-foreground">
            Contact form submissions from the public website
          </p>
        </div>
        {newCount > 0 && (
          <Badge className="bg-primary text-white">{newCount} new</Badge>
        )}
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-destructive">
            Failed to load messages. Please try again.
          </CardContent>
        </Card>
      )}

      {messages && messages.length === 0 && (
        <Card>
          <CardContent className="p-12 flex flex-col items-center gap-3 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground/50" />
            <p className="font-medium">No messages yet</p>
            <p className="text-sm text-muted-foreground">
              Contact form submissions will show up here.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {messages?.map((m) => <MessageCard key={m.id} message={m} />)}
      </div>
    </div>
  );
}

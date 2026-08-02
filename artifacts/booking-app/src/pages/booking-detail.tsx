import React, { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { 
  useGetBooking, 
  useUpdateBooking, 
  useDeleteBooking,
  getGetBookingQueryKey,
  getListBookingsQueryKey,
  getGetUpcomingBookingsQueryKey,
  getGetBookingStatsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, ServiceTypeBadge } from "@/components/badges";
import { formatDate, formatTime, formatCurrency } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft, MapPin, Phone, Mail, Home, Clock, Calendar, 
  Edit3, Trash2, CheckCircle2, AlertCircle, FileText, 
  User, ChevronDown, ChevronUp, Mic
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { JobberSyncCard, type JobberSyncStatus } from "@/components/jobber-sync-card";

function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

interface CallTranscriptRow {
  id: number;
  bookingId: number;
  transcript: string;
  callDurationSeconds: number | null;
  createdAt: string;
}

export default function BookingDetail() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [jobberJobId, setJobberJobId] = useState<string | null | undefined>(undefined);
  const [jobberSyncStatus, setJobberSyncStatus] = useState<JobberSyncStatus | null | undefined>(undefined);
  const [jobberSyncError, setJobberSyncError] = useState<string | null | undefined>(undefined);

  const [transcripts, setTranscripts] = useState<CallTranscriptRow[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const { data: booking, isLoading, isError } = useGetBooking(id, {
    query: {
      enabled: !!id,
      queryKey: getGetBookingQueryKey(id),
      select: (data: any) => {
        // Sync jobber fields into local state on first load
        if (jobberJobId === undefined && data?.jobberJobId !== undefined) {
          setJobberJobId(data.jobberJobId);
        }
        if (jobberSyncStatus === undefined && data?.jobberSyncStatus !== undefined) {
          setJobberSyncStatus(data.jobberSyncStatus as JobberSyncStatus);
          setJobberSyncError(data.jobberSyncError ?? null);
        }
        return data;
      }
    }
  });

  const updateBooking = useUpdateBooking();
  const deleteBooking = useDeleteBooking();

  // Fetch call transcript for this booking
  useEffect(() => {
    if (!id) return;
    fetch(`${getBaseUrl()}api/call-transcripts/${id}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((rows: CallTranscriptRow[]) => setTranscripts(rows))
      .catch(() => {});
  }, [id]);

  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`${getBaseUrl()}api/call-transcripts/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: noteText.trim() }),
      });
      if (!res.ok) throw new Error("Failed to save note");
      const newRow: CallTranscriptRow = await res.json();
      setTranscripts((prev) => [...prev, newRow]);
      setNoteText("");
      setAddNoteOpen(false);
      setTranscriptOpen(true);
      toast({ title: "Note saved", description: "Call note added to this booking." });
    } catch {
      toast({ title: "Error", description: "Failed to save call note.", variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  };

  if (isError) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-2xl font-bold">Booking Not Found</h2>
        <p className="text-muted-foreground mt-2">The booking you are looking for does not exist or was deleted.</p>
        <Button className="mt-6" variant="outline" onClick={() => setLocation("/bookings")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Bookings
        </Button>
      </div>
    );
  }

  const handleStatusChange = (newStatus: string) => {
    updateBooking.mutate({
      id,
      data: { status: newStatus as any }
    }, {
      onSuccess: (data) => {
        toast({ title: "Status Updated", description: `Booking marked as ${newStatus}` });
        queryClient.setQueryData(getGetBookingQueryKey(id), data);
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetUpcomingBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBookingStatsQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
      }
    });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to completely delete this booking? This action cannot be undone.")) {
      deleteBooking.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Booking Deleted" });
          queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetUpcomingBookingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBookingStatsQueryKey() });
          setLocation("/bookings");
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to delete booking", variant: "destructive" });
        }
      });
    }
  };

  if (isLoading || !booking) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/4" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-in slide-in-from-bottom-4 duration-500 pb-10">
      
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <Button variant="ghost" onClick={() => window.history.back()} className="gap-2 -ml-4 hover:bg-transparent">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-muted/50 p-1.5 rounded-lg border">
            <span className="text-sm font-medium text-muted-foreground px-2">Update Status:</span>
            <NativeSelect 
              value={booking.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={updateBooking.isPending}
              className="h-8 text-sm py-1 font-semibold bg-background border-none shadow-sm min-w-[140px]"
            >
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </NativeSelect>
          </div>
          <Button variant="destructive" size="icon" onClick={handleDelete} title="Delete Booking">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
        
        <div className="space-y-6">
          {/* Main Info Card */}
          <Card className="shadow-lg border-t-4 border-t-primary overflow-hidden">
            <div className="bg-primary/5 p-6 border-b flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h1 className="text-3xl font-bold font-serif mb-2">{booking.firstName} {booking.lastName}</h1>
                <div className="flex flex-wrap gap-2 items-center">
                  <StatusBadge status={booking.status} className="text-sm px-3 py-1" />
                  <ServiceTypeBadge type={booking.serviceType} className="text-sm px-3 py-1" />
                </div>
              </div>
              <div className="text-right bg-background p-4 rounded-xl shadow-sm border text-center min-w-[120px]">
                <div className="text-sm text-muted-foreground font-medium mb-1 uppercase tracking-wider">Estimated</div>
                <div className="text-2xl font-black text-primary">{formatCurrency(booking.estimatedPrice)}</div>
              </div>
            </div>

            <CardContent className="p-0">
              <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x">
                {/* Contact */}
                <div className="p-6 space-y-4">
                  <h3 className="font-semibold flex items-center gap-2 text-muted-foreground uppercase text-xs tracking-wider"><User className="w-4 h-4" /> Contact Details</h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <div className="font-medium text-lg">{booking.phone}</div>
                        <div className="text-sm text-muted-foreground">Mobile</div>
                      </div>
                    </div>
                    {booking.email && (
                      <div className="flex items-start gap-3">
                        <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <div className="font-medium">{booking.email}</div>
                          <div className="text-sm text-muted-foreground">Email</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Location */}
                <div className="p-6 space-y-4 bg-muted/10">
                  <h3 className="font-semibold flex items-center gap-2 text-muted-foreground uppercase text-xs tracking-wider"><MapPin className="w-4 h-4" /> Location</h3>
                  <div className="flex items-start gap-3">
                    <div className="bg-background border shadow-sm p-3 rounded-lg w-full">
                      <div className="font-bold text-lg mb-1">{booking.address}</div>
                      <div className="text-muted-foreground">
                        {booking.city}, {booking.province} {booking.postalCode}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes Card */}
          {booking.notes && (
            <Card className="bg-amber-50/50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-900/30 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-amber-800 dark:text-amber-500">
                  <FileText className="w-5 h-5" /> Important Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-amber-900/80 dark:text-amber-200 leading-relaxed font-medium">
                  {booking.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Call Transcript Card */}
          <Card className="shadow-sm border-purple-200 dark:border-purple-900/40">
            <CardHeader className="pb-3 bg-purple-50/60 dark:bg-purple-950/20 rounded-t-xl border-b border-purple-100 dark:border-purple-900/30">
              <CardTitle className="text-base flex items-center justify-between gap-2 text-purple-800 dark:text-purple-400">
                <button
                  type="button"
                  className="flex items-center gap-2 flex-1 text-left"
                  onClick={() => transcripts.length > 0 && setTranscriptOpen((v) => !v)}
                >
                  <Mic className="w-4 h-4" />
                  Call Notes
                  {transcripts.length > 0 && (
                    <span className="text-xs font-normal bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-full">
                      {transcripts.length}
                    </span>
                  )}
                  {transcripts.length > 0 && (
                    transcriptOpen ? (
                      <ChevronUp className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    )
                  )}
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-purple-700 border-purple-300 hover:bg-purple-100 dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-900/30 h-7 px-2.5 text-xs"
                  onClick={() => setAddNoteOpen((v) => !v)}
                >
                  {addNoteOpen ? "Cancel" : "+ Add Note"}
                </Button>
              </CardTitle>
            </CardHeader>

            {addNoteOpen && (
              <CardContent className="pt-4 pb-4 border-b border-purple-100 dark:border-purple-900/30">
                <textarea
                  className="w-full rounded-lg border border-purple-200 dark:border-purple-800 bg-background p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 min-h-[100px]"
                  placeholder="Enter call notes or transcript…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  disabled={savingNote}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setAddNoteOpen(false); setNoteText(""); }}
                    disabled={savingNote}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveNote}
                    disabled={savingNote || !noteText.trim()}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {savingNote ? "Saving…" : "Save Note"}
                  </Button>
                </div>
              </CardContent>
            )}

            {transcripts.length > 0 && transcriptOpen && (
              <CardContent className="pt-4 space-y-3">
                {transcripts.map((t) => (
                  <div key={t.id}>
                    <div className="text-xs text-purple-500 dark:text-purple-400 mb-1">
                      {new Date(t.createdAt).toLocaleString()}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed font-mono bg-muted/40 rounded-lg p-4 border">
                      {t.transcript}
                    </p>
                  </div>
                ))}
              </CardContent>
            )}

            {transcripts.length === 0 && !addNoteOpen && (
              <CardContent className="pt-4 pb-4">
                <p className="text-sm text-muted-foreground text-center py-2">No call notes yet.</p>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card className="shadow-md">
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2"><Calendar className="w-5 h-5" /> Schedule</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              
              <div className="flex items-center gap-4 bg-primary/10 p-4 rounded-xl border border-primary/20">
                 <div className="bg-background rounded-md shadow-sm w-14 h-14 flex flex-col items-center justify-center font-serif flex-shrink-0">
                   <div className="text-xs font-bold text-primary uppercase bg-primary/10 w-full text-center py-0.5 rounded-t-md">{new Date(booking.scheduledDate).toLocaleDateString('en-US', { month: 'short' })}</div>
                   <div className="text-xl font-black">{new Date(booking.scheduledDate).getDate()}</div>
                 </div>
                 <div>
                   <div className="font-bold text-lg">{formatDate(booking.scheduledDate)}</div>
                   <div className="text-muted-foreground flex items-center gap-1.5"><Clock className="w-4 h-4" /> {formatTime(booking.scheduledTime)}</div>
                 </div>
              </div>

              <div className="flex justify-between items-center py-3 border-b">
                <span className="text-muted-foreground">Frequency</span>
                <span className="font-semibold capitalize bg-muted px-2.5 py-1 rounded-md text-sm">{booking.frequency.replace('_', ' ')}</span>
              </div>
              
              <div className="flex justify-between items-center py-2">
                <span className="text-muted-foreground">Created</span>
                <span className="text-sm font-medium">{new Date(booking.createdAt).toLocaleDateString()}</span>
              </div>

            </CardContent>
          </Card>

          {/* Jobber sync */}
          <JobberSyncCard
            bookingId={id}
            jobberJobId={jobberJobId ?? booking?.jobberJobId}
            jobberSyncStatus={
              (jobberSyncStatus ?? (booking as any)?.jobberSyncStatus) as JobberSyncStatus | null | undefined
            }
            jobberSyncError={jobberSyncError ?? (booking as any)?.jobberSyncError}
            onSynced={(jid) => {
              setJobberJobId(jid);
              setJobberSyncStatus("synced");
              setJobberSyncError(null);
            }}
            onStatusChange={(status, error) => {
              setJobberSyncStatus(status);
              setJobberSyncError(error ?? null);
            }}
            baseUrl={getBaseUrl()}
          />

          <Card className="shadow-md">
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2"><Home className="w-5 h-5" /> Property Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-background border p-3 rounded-lg text-center shadow-sm">
                  <div className="text-2xl font-black text-foreground">{booking.bedrooms}</div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold mt-1">Bedrooms</div>
                </div>
                <div className="bg-background border p-3 rounded-lg text-center shadow-sm">
                  <div className="text-2xl font-black text-foreground">{booking.bathrooms}</div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold mt-1">Bathrooms</div>
                </div>
              </div>

              {booking.extras && booking.extras.length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Included Extras</h4>
                  <div className="flex flex-wrap gap-2">
                    {booking.extras.map((extra: string) => (
                      <span key={extra} className="bg-secondary/10 text-secondary border border-secondary/20 px-2.5 py-1 rounded-full text-xs font-bold">
                        {extra}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}

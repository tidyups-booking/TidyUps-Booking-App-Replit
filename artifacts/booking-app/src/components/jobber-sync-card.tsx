/**
 * Shows Jobber sync status on a booking detail page.
 * Statuses: not_started / pending / synced / failed
 */
import React, { useState } from "react";
import { ExternalLink, RefreshCw, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export type JobberSyncStatus = "not_started" | "pending" | "synced" | "failed";

interface Props {
  bookingId: number;
  jobberJobId?: string | null;
  jobberSyncStatus?: JobberSyncStatus | null;
  jobberSyncError?: string | null;
  onSynced?: (jobberRequestId: string) => void;
  onStatusChange?: (status: JobberSyncStatus, error?: string | null) => void;
  baseUrl: string;
}

// Construct a link to the Jobber request (web app URL pattern)
function jobberRequestUrl(id: string) {
  return `https://secure.getjobber.com/requests/${id}`;
}

export function JobberSyncCard({
  bookingId,
  jobberJobId,
  jobberSyncStatus,
  jobberSyncError,
  onSynced,
  onStatusChange,
  baseUrl,
}: Props) {
  const [syncing, setSyncing] = useState(false);
  const [localId, setLocalId] = useState(jobberJobId);
  const [localStatus, setLocalStatus] = useState<JobberSyncStatus | null | undefined>(
    jobberSyncStatus
  );
  const [localError, setLocalError] = useState<string | null | undefined>(jobberSyncError);

  // Keep local state in sync with props when they change (e.g. on refetch)
  React.useEffect(() => {
    setLocalId(jobberJobId);
    setLocalStatus(jobberSyncStatus);
    setLocalError(jobberSyncError);
  }, [jobberJobId, jobberSyncStatus, jobberSyncError]);

  const handleSync = async () => {
    setSyncing(true);
    setLocalStatus("pending");
    setLocalError(null);
    onStatusChange?.("pending", null);
    try {
      const res = await fetch(`${baseUrl}api/jobber/sync/${bookingId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setLocalId(data.jobberRequestId);
      setLocalStatus("synced");
      setLocalError(null);
      onSynced?.(data.jobberRequestId);
      onStatusChange?.("synced", null);
    } catch (e: any) {
      setLocalStatus("failed");
      setLocalError(e.message);
      onStatusChange?.("failed", e.message);
    } finally {
      setSyncing(false);
    }
  };

  const effectiveStatus = localStatus ?? "not_started";
  const isSynced = effectiveStatus === "synced" && !!localId;
  const isPending = effectiveStatus === "pending" || syncing;
  const isFailed = effectiveStatus === "failed" && !syncing;

  return (
    <Card className="shadow-md">
      <CardHeader className="bg-muted/30 border-b pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          {/* Jobber brand icon via initials */}
          <span className="w-5 h-5 rounded bg-[#F4B400] text-white text-xs font-black flex items-center justify-center leading-none">
            J
          </span>
          Jobber
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-3">
        {isSynced ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-medium">Synced to Jobber</span>
            </div>
            <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground break-all">
              {localId}
            </div>
            <a
              href={jobberRequestUrl(localId!)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in Jobber
            </a>
          </div>
        ) : isPending ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <Clock className="w-4 h-4 animate-pulse" />
              <span className="text-sm font-medium">Sync in progress…</span>
            </div>
            <p className="text-xs text-muted-foreground">
              This booking is being pushed to Jobber. Refresh the page in a moment to see the result.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {isFailed ? (
              <>
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">Sync failed</span>
                </div>
                {localError && (
                  <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 rounded-lg p-2">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span className="break-all">{localError}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                This booking hasn't been pushed to Jobber yet.
              </p>
            )}
            <Button
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              variant={isFailed ? "destructive" : "default"}
              className="w-full gap-2"
            >
              {syncing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : isFailed ? (
                <RefreshCw className="w-4 h-4" />
              ) : (
                <span className="w-4 h-4 rounded bg-[#F4B400] text-white text-xs font-black flex items-center justify-center leading-none">
                  J
                </span>
              )}
              {syncing ? "Syncing…" : isFailed ? "Retry Sync" : "Create Request in Jobber"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import React from "react";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const getStatusStyles = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50";
      case "confirmed":
        return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50";
      case "in_progress":
        return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800/50";
      case "completed":
        return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/50";
      case "cancelled":
        return "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800/50";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pending": return "Pending";
      case "confirmed": return "Confirmed";
      case "in_progress": return "In Progress";
      case "completed": return "Completed";
      case "cancelled": return "Cancelled";
      default: return status;
    }
  };

  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors hover:opacity-80 cursor-default", getStatusStyles(status), className)}>
      {getStatusLabel(status)}
    </span>
  );
}

export function ServiceTypeBadge({ type, className }: { type: string; className?: string }) {
  const getLabel = (t: string) => {
    switch (t) {
      case "standard_clean": return "Standard Clean";
      case "deep_clean": return "Deep Clean";
      case "move_in_out": return "Move In/Out";
      case "move_in": return "Move-In Clean";
      case "move_out": return "Move-Out Clean";
      case "post_construction": return "Post-Construction";
      default: return t;
    }
  };

  return (
    <span className={cn("inline-flex items-center px-2 py-1 rounded bg-secondary/10 text-secondary text-xs font-medium border border-secondary/20", className)}>
      {getLabel(type)}
    </span>
  );
}

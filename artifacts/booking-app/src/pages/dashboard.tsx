import React from "react";
import { Link } from "wouter";
import { useGetBookingStats, useGetUpcomingBookings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, ServiceTypeBadge } from "@/components/badges";
import { formatDate, formatTime, formatCurrency, cn } from "@/lib/utils";
import { DollarSign, Calendar, Clock, AlertCircle, ArrowRight, Activity, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobberStatus } from "@/components/jobber-status";
import { TwilioWebhookStatus } from "@/components/twilio-webhook-status";

function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetBookingStats();
  const { data: upcoming, isLoading: upcomingLoading } = useGetUpcomingBookings();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight brand-gradient-text">Good morning, Dispatch</h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">Here's what's happening today at 833 Tidyups.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <JobberStatus baseUrl={getBaseUrl()} />
          <TwilioWebhookStatus baseUrl={getBaseUrl()} />
          <Link href="/new">
            <Button size="lg" className="w-full md:w-auto gap-2">
              <Calendar className="w-5 h-5" />
              Book Customer
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Stat Cards */}
        <StatCard
          title="Total Revenue"
          value={stats ? formatCurrency(stats.totalRevenue) : null}
          icon={<DollarSign className="h-5 w-5 text-emerald-500" />}
          loading={statsLoading}
        />
        <StatCard
          title="Upcoming Bookings"
          value={stats?.upcomingCount}
          icon={<CalendarDays className="h-5 w-5 text-blue-500" />}
          loading={statsLoading}
        />
        <StatCard
          title="Pending Approvals"
          value={stats?.pendingCount}
          icon={<AlertCircle className="h-5 w-5 text-amber-500" />}
          loading={statsLoading}
          highlight={stats && stats.pendingCount > 0}
        />
        <StatCard
          title="Completed"
          value={stats?.completedCount}
          icon={<Activity className="h-5 w-5 text-purple-500" />}
          loading={statsLoading}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-12">
        <Card className="md:col-span-8 shadow-sm border-t-4 border-t-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
            <div className="space-y-0.5">
              <CardTitle className="text-xl">Upcoming Schedule</CardTitle>
              <p className="text-sm text-muted-foreground">Next 14 days</p>
            </div>
            <Link href="/bookings">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                View All <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {upcomingLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : upcoming && upcoming.length > 0 ? (
              <div className="divide-y">
                {upcoming.map(booking => (
                  <Link key={booking.id} href={`/bookings/${booking.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-muted/50 transition-colors gap-4">
                    <div className="flex gap-4 items-start">
                      <div className="bg-primary/10 rounded-lg p-3 text-center min-w-[70px] flex-shrink-0 flex flex-col justify-center border border-primary/20">
                        <span className="text-xs font-bold text-primary uppercase">{new Date(booking.scheduledDate).toLocaleDateString('en-US', { month: 'short' })}</span>
                        <span className="text-lg font-black text-foreground leading-none">{new Date(booking.scheduledDate).getDate()}</span>
                      </div>
                      <div>
                        <h4 className="font-semibold text-lg">{booking.firstName} {booking.lastName}</h4>
                        <div className="flex items-center text-sm text-muted-foreground gap-2 mt-1 flex-wrap">
                          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatTime(booking.scheduledTime)}</span>
                          <span>•</span>
                          <span className="truncate max-w-[200px]">{booking.city}, {booking.province}</span>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <ServiceTypeBadge type={booking.serviceType} />
                          <StatusBadge status={booking.status} />
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0">
                       <span className="text-sm font-medium text-muted-foreground">Price</span>
                       <span className="font-bold text-lg">{formatCurrency(booking.estimatedPrice)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No upcoming bookings scheduled.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-4 bg-secondary/5 border-secondary/20 h-fit">
          <CardHeader>
            <CardTitle className="text-lg">Quick Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-secondary/10 pb-2">
                  <span className="text-sm text-muted-foreground">Total Bookings</span>
                  <span className="font-semibold">{stats?.totalBookings}</span>
                </div>
                <div className="flex justify-between items-center border-b border-secondary/10 pb-2">
                  <span className="text-sm text-muted-foreground">This Week</span>
                  <span className="font-semibold">{stats?.thisWeekCount}</span>
                </div>
                <div className="flex justify-between items-center border-b border-secondary/10 pb-2">
                  <span className="text-sm text-muted-foreground">This Month</span>
                  <span className="font-semibold">{stats?.thisMonthCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground text-rose-500">Cancelled</span>
                  <span className="font-semibold text-rose-600">{stats?.cancelledCount}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, loading, highlight }: { title: string; value: string | number | null | undefined; icon: React.ReactNode; loading?: boolean; highlight?: boolean }) {
  return (
    <Card className={cn("transition-shadow hover:shadow-md", highlight && "border-amber-400 bg-amber-50/30 dark:bg-amber-900/10")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground font-sans">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-3xl font-bold font-serif">{value !== undefined ? value : "—"}</div>
        )}
      </CardContent>
    </Card>
  );
}

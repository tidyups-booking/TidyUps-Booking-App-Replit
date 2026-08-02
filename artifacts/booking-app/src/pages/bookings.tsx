import React from "react";
import { Link } from "wouter";
import { useListBookings, ListBookingsStatus } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusBadge, ServiceTypeBadge } from "@/components/badges";
import { formatDate, formatTime } from "@/lib/utils";
import { Search, Loader2, Mic } from "lucide-react";

export default function BookingsList() {
  const [statusFilter, setStatusFilter] = React.useState<ListBookingsStatus | "all">("all");
  const [search, setSearch] = React.useState("");

  const { data: bookings, isLoading } = useListBookings(
    statusFilter === "all" ? {} : { status: statusFilter }
  );

  const filteredBookings = React.useMemo(() => {
    if (!bookings) return [];
    if (!search) return bookings;
    const lowerSearch = search.toLowerCase();
    return bookings.filter(b => 
      b.firstName.toLowerCase().includes(lowerSearch) ||
      b.lastName.toLowerCase().includes(lowerSearch) ||
      b.city.toLowerCase().includes(lowerSearch) ||
      b.phone.includes(search)
    );
  }, [bookings, search]);

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-serif text-secondary">All Bookings</h1>
          <p className="text-muted-foreground text-sm">Manage and track all customer appointments.</p>
        </div>
      </div>

      <Card className="border-t-4 border-t-secondary shadow-sm">
        <div className="p-4 border-b bg-muted/20 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search by name, city, or phone..." 
              className="pl-9 bg-background"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-48">
            <NativeSelect 
              value={statusFilter} 
              onChange={e => setStatusFilter(e.target.value as any)}
              className="bg-background"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </NativeSelect>
          </div>
        </div>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/30 border-b">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Location</th>
                  <th className="px-4 py-3 font-medium">Date & Time</th>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                    </td>
                  </tr>
                ) : filteredBookings.length > 0 ? (
                  filteredBookings.map(booking => (
                    <tr key={booking.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors group">
                      <td className="px-4 py-3">
                        <Link href={`/bookings/${booking.id}`} className="font-semibold text-foreground group-hover:text-primary transition-colors flex flex-col">
                          <span className="flex items-center gap-1.5">
                            {booking.firstName} {booking.lastName}
                            {booking.hasTranscript && (
                              <span title="Call transcript attached" className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/10 text-primary shrink-0">
                                <Mic className="w-2.5 h-2.5" />
                              </span>
                            )}
                          </span>
                          <span className="text-xs font-normal text-muted-foreground">{booking.phone}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                        {booking.city}, {booking.province}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium">{formatDate(booking.scheduledDate)}</div>
                        <div className="text-xs text-muted-foreground">{formatTime(booking.scheduledTime)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <ServiceTypeBadge type={booking.serviceType} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={booking.status} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No bookings found matching your criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

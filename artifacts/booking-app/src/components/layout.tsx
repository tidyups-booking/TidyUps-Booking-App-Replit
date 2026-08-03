import React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutDashboard, CalendarPlus, List, Menu, CalendarDays, Users, Map, Inbox, Settings } from "lucide-react";
import { LiveCallProvider, useLiveCall } from "@/contexts/live-call-context";
import { CallAlertBanner } from "@/components/call-alert-banner";
import { SiteFooter } from "@/components/footer";
import logoImg from "@assets/833tidyups-logo.png";

function LayoutInner({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const { bannerVisible } = useLiveCall();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/new", label: "New Booking", icon: CalendarPlus, primary: true },
    { href: "/map", label: "Live Map", icon: Map },
    { href: "/schedule", label: "Schedule", icon: CalendarDays },
    { href: "/bookings", label: "All Bookings", icon: List },
    { href: "/staff", label: "Staff", icon: Users },
    { href: "/messages", label: "Messages", icon: Inbox },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className={cn("min-h-[100dvh] flex flex-col bg-background", bannerVisible && "pt-11")}>
      <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
              <img src={logoImg} alt="833 Tidyups Logo" className="h-10 w-10 object-contain rounded-md" />
              <span className="font-serif font-bold text-xl hidden sm:inline-block tracking-tight text-foreground">
                833 Tidyups <span className="text-primary font-sans text-sm font-medium tracking-normal align-middle ml-1 px-2 py-0.5 bg-primary/10 rounded-full">Dispatch</span>
              </span>
            </Link>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              
              if (item.primary) {
                return (
                  <Link key={item.href} href={item.href} className="flex items-center gap-2 px-5 py-2.5 rounded-full font-medium text-white brand-gradient shadow-md shadow-primary/25 hover:shadow-lg hover:-translate-y-0.5 transition-all">
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary relative py-2",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 brand-gradient rounded-t-full" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2 text-muted-foreground hover:bg-muted rounded-md"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t bg-card animate-in slide-in-from-top-2">
            <nav className="flex flex-col p-4 gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                      item.primary ? "brand-gradient text-white shadow-sm mt-2" : isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}

/** Authenticated-only shell — mounts the global SSE call context here so
 *  unauthenticated routes never open an SSE connection. */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <LiveCallProvider>
      <CallAlertBanner />
      <LayoutInner>{children}</LayoutInner>
    </LiveCallProvider>
  );
}

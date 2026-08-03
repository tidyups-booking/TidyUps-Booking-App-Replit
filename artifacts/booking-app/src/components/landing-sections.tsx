import { Link } from "wouter";
import { ShieldCheck, Building2, Leaf, CalendarClock, ArrowRight } from "lucide-react";
import mascotCovered from "@assets/brand-doc/mascot-covered.jpeg";
import sparkleLivingRoom from "@assets/brand-doc/sparkle-living-room.jpeg";
import fleetTrucks from "@assets/brand-doc/fleet-trucks.jpg";
import { Button } from "@/components/ui/button";

const COMMERCIAL_PROMISES = [
  {
    icon: ShieldCheck,
    title: "Professional Sanitation Standards",
    text: "Offices, schools, and workspaces across Edmonton.",
  },
  {
    icon: Building2,
    title: "CDC-Style Cleaning",
    text: "Rigorous sanitation protocols for a safer environment.",
  },
  {
    icon: Leaf,
    title: "Eco-Friendly Products",
    text: "Safe for people and the planet.",
  },
  {
    icon: CalendarClock,
    title: "Flexible Scheduling",
    text: "We work around YOUR hours.",
  },
];

/**
 * Marketing sections shown on the public landing page, below the sign-in hero.
 * Brand imagery + commercial cleaning pitch for visitors who scroll.
 */
export function LandingSections() {
  return (
    <div className="bg-background">
      {/* Slogan band — brand mascot imagery */}
      <section id="brand" className="container mx-auto px-4 py-14 md:py-20">
        <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
          <div className="rounded-2xl overflow-hidden shadow-lg border">
            <img
              src={mascotCovered}
              alt="833 Tidyups mascot — We've Got You Covered!"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="rounded-2xl overflow-hidden shadow-lg border">
            <img
              src={sparkleLivingRoom}
              alt="A sparkling clean living room — We Make It Sparkle!"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      {/* Commercial cleaning */}
      <section id="commercial" className="border-y bg-gradient-to-br from-pink-50/60 via-background to-purple-50/60 dark:from-pink-950/20 dark:via-background dark:to-purple-950/20">
        <div className="container mx-auto px-4 py-14 md:py-20 max-w-5xl">
          <div className="text-center mb-10">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-2">
              Commercial Cleaning
            </p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight brand-gradient-text pb-1">
              A Clean Workplace is a Healthier, Happier Workplace
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
              We clean offices, schools, and workspaces across Edmonton to
              CDC-style sanitation standards — with eco-friendly products and
              flexible scheduling that works around your hours.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-10">
            {COMMERCIAL_PROMISES.map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="rounded-xl border bg-card p-5 text-center shadow-sm"
              >
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full brand-gradient text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-sm mb-1.5">{title}</h3>
                <p className="text-xs text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link href="/contact">
              <Button size="lg" className="brand-gradient text-white shadow-md shadow-primary/20">
                Get a Commercial Quote
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Fleet */}
      <section id="fleet" className="container mx-auto px-4 py-14 md:py-20 max-w-5xl">
        <div className="text-center mb-8">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight brand-gradient-text pb-1">
            Watch for Our Fleet Around Edmonton
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
            Our purple team is on the road every day — leave the mess to us!
          </p>
        </div>
        <div className="rounded-2xl overflow-hidden shadow-xl border">
          <img
            src={fleetTrucks}
            alt="The 833 Tidyups cleaning fleet — trucks and vans wrapped in purple branding"
            className="w-full object-cover"
            loading="lazy"
          />
        </div>
      </section>
    </div>
  );
}

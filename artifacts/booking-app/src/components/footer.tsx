import { Link } from "wouter";
import { Phone, Mail, Clock } from "lucide-react";
import logoImg from "@assets/833tidyups-logo.png";

export const COMPANY_PHONE = "1-833-843-9877";
export const COMPANY_PHONE_DISPLAY = "1-833-TIDYUPS (843-9877)";
export const COMPANY_EMAIL = "hello@833tidyups.com";
export const COMPANY_HOURS = [
  "Monday – Friday: 8:00 AM – 6:00 PM",
  "Saturday: 9:00 AM – 4:00 PM",
  "Sunday: Closed",
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-card">
      <div className="container mx-auto px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3">
          {/* Brand */}
          <div className="space-y-3">
            <Link
              href="/"
              className="flex items-center gap-3 transition-opacity hover:opacity-80 w-fit"
            >
              <img
                src={logoImg}
                alt="833 Tidyups Logo"
                className="h-10 w-10 object-contain rounded-md"
              />
              <span className="font-serif font-bold text-lg tracking-tight text-foreground">
                833 Tidyups
              </span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs">
              Professional home cleaning across Alberta — sparkling results,
              friendly cleaners, and easy booking.
            </p>
            <span className="block h-1 w-20 brand-gradient rounded-full" />
          </div>

          {/* Links */}
          <div>
            <h3 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Company
            </h3>
            <nav className="flex flex-col gap-2">
              <Link
                href="/support"
                className="text-sm text-foreground hover:text-primary transition-colors w-fit"
              >
                Support
              </Link>
              <Link
                href="/contact"
                className="text-sm text-foreground hover:text-primary transition-colors w-fit"
              >
                Contact
              </Link>
              <Link
                href="/privacy"
                className="text-sm text-foreground hover:text-primary transition-colors w-fit"
              >
                Privacy Policy
              </Link>
            </nav>
          </div>

          {/* Contact info */}
          <div>
            <h3 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Get in Touch
            </h3>
            <div className="flex flex-col gap-2.5 text-sm text-foreground">
              <a
                href={`tel:${COMPANY_PHONE}`}
                className="flex items-center gap-2 hover:text-primary transition-colors w-fit"
              >
                <Phone className="w-4 h-4 text-primary shrink-0" />
                {COMPANY_PHONE_DISPLAY}
              </a>
              <a
                href={`mailto:${COMPANY_EMAIL}`}
                className="flex items-center gap-2 hover:text-primary transition-colors w-fit"
              >
                <Mail className="w-4 h-4 text-primary shrink-0" />
                {COMPANY_EMAIL}
              </a>
              <div className="flex items-start gap-2 text-muted-foreground">
                <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  {COMPANY_HOURS.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            © {year} 833 Tidyups. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <Link
              href="/privacy"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/support"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Help
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

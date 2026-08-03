import { Link } from "wouter";
import { Phone, Mail, Clock, Globe, MapPin, CreditCard } from "lucide-react";
import {
  FaFacebookF,
  FaInstagram,
  FaTiktok,
  FaYoutube,
  FaXTwitter,
  FaLinkedinIn,
  FaPinterestP,
  FaSnapchat,
  FaThreads,
  FaWhatsapp,
} from "react-icons/fa6";
import { useListSocialLinks } from "@workspace/api-client-react";
import logoImg from "@assets/833tidyups-logo.png";

const SOCIAL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  facebook: FaFacebookF,
  instagram: FaInstagram,
  tiktok: FaTiktok,
  youtube: FaYoutube,
  x: FaXTwitter,
  twitter: FaXTwitter,
  "x-twitter": FaXTwitter,
  linkedin: FaLinkedinIn,
  pinterest: FaPinterestP,
  snapchat: FaSnapchat,
  threads: FaThreads,
  whatsapp: FaWhatsapp,
};

function SocialIconRow() {
  const { data: links } = useListSocialLinks();
  const visible = (links ?? []).filter((l) => l.url.trim() !== "");
  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-2 pt-1">
      {visible.map((link) => {
        const Icon = SOCIAL_ICONS[link.platform] ?? Globe;
        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.label}
            title={link.label}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <Icon className="h-4 w-4" />
          </a>
        );
      })}
    </div>
  );
}

export const COMPANY_PHONE = "1-833-843-9877";
export const COMPANY_PHONE_DISPLAY = "1-833-TIDYUPS (843-9877)";
export const COMPANY_PHONE_LOCAL = "+15877422500";
export const COMPANY_PHONE_LOCAL_DISPLAY = "(587) 742-2500";
export const COMPANY_EMAIL = "support@bookcleaning.app";
export const COMPANY_ADDRESS_LINES = [
  "6510 Gateway Blvd NW Suite 1020",
  "Edmonton, AB T6H 5Z5",
];
export const COMPANY_MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(
    "833 Tidyups, 6510 Gateway Blvd NW Suite 1020, Edmonton, AB T6H 5Z5",
  );
export const SERVICE_AREAS = [
  "Edmonton",
  "St. Albert",
  "Sherwood Park",
  "Leduc",
  "Beaumont",
  "Spruce Grove",
];
export const PAYMENT_METHODS = [
  "Cash",
  "Visa",
  "Mastercard",
  "American Express",
  "PayPal",
  "e-Transfer",
  "Google Pay",
  "Apple Pay",
];
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
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
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
            <SocialIconRow />
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

          {/* Service areas */}
          <div>
            <h3 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Service Areas
            </h3>
            <ul className="flex flex-col gap-2">
              {SERVICE_AREAS.map((area) => (
                <li key={area} className="text-sm text-foreground">
                  {area}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              …and surrounding areas within a 15-mile radius
            </p>
          </div>

          {/* Contact info */}
          <div>
            <h3 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Get in Touch
            </h3>
            <div className="flex flex-col gap-2.5 text-sm text-foreground">
              <a
                href={COMPANY_MAPS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 hover:text-primary transition-colors w-fit"
              >
                <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>
                  {COMPANY_ADDRESS_LINES.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </span>
              </a>
              <a
                href={`tel:${COMPANY_PHONE}`}
                className="flex items-center gap-2 hover:text-primary transition-colors w-fit"
              >
                <Phone className="w-4 h-4 text-primary shrink-0" />
                {COMPANY_PHONE_DISPLAY}
              </a>
              <a
                href={`tel:${COMPANY_PHONE_LOCAL}`}
                className="flex items-center gap-2 hover:text-primary transition-colors w-fit"
              >
                <Phone className="w-4 h-4 text-primary shrink-0" />
                {COMPANY_PHONE_LOCAL_DISPLAY}
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

        <div className="mt-8 pt-6 border-t space-y-3">
          <p className="text-xs text-muted-foreground flex items-center justify-center sm:justify-start gap-1.5 flex-wrap">
            <CreditCard className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>We accept: {PAYMENT_METHODS.join(" · ")}</span>
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
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
      </div>
    </footer>
  );
}

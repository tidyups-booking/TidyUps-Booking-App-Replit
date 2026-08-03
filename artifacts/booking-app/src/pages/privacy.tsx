import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { PublicPage, PublicPageHero } from "@/components/public-page";
import {
  COMPANY_PHONE_DISPLAY,
  COMPANY_EMAIL,
} from "@/components/footer";

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold flex items-baseline gap-3">
        <span className="brand-gradient-text font-serif">{number}</span>
        {title}
      </h2>
      <div className="text-muted-foreground leading-relaxed space-y-3 text-[0.95rem]">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <PublicPage
      title="Privacy Policy"
      description="How 833 Tidyups collects, uses, and protects your personal information — booking details, call transcripts, and cleaner location data."
    >
      <PublicPageHero
        eyebrow="Legal"
        title="Privacy Policy"
        subtitle="We take your privacy seriously. This policy explains what information we collect, why we collect it, and how we protect it."
      />

      <Card className="shadow-sm border-t-4 border-t-primary">
        <CardContent className="pt-8 pb-10 px-6 md:px-10 space-y-8">
          <div className="flex items-center gap-3 text-sm text-muted-foreground border-b pb-6">
            <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
            <p>
              <strong className="text-foreground">Last updated:</strong> August
              3, 2026. This policy applies to 833 Tidyups' booking services,
              phone lines, website, and mobile apps.
            </p>
          </div>

          <Section number="1" title="Overview">
            <p>
              833 Tidyups ("we", "us", or "our") provides residential cleaning
              services in Alberta, Canada. To schedule cleans, dispatch our
              team, and deliver great service, we collect a limited amount of
              personal information. This policy describes that information and
              the choices you have.
            </p>
          </Section>

          <Section number="2" title="Information We Collect">
            <p>We collect the following categories of information:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-foreground">
                  Customer and booking details.
                </strong>{" "}
                Your name, phone number, email address, service address, and
                the details of your booking (service type, home size, schedule,
                pricing, and any notes you provide).
              </li>
              <li>
                <strong className="text-foreground">
                  Call recordings and transcripts.
                </strong>{" "}
                When you call our booking line, the call may be transcribed so
                our dispatch team can accurately capture your booking details.
                Transcripts are linked to your booking record.
              </li>
              <li>
                <strong className="text-foreground">
                  Cleaner location data.
                </strong>{" "}
                For our staff, we collect GPS location from the cleaner mobile
                app <em>only during working hours</em> (8:00 AM – 8:00 PM) so
                dispatchers can coordinate routes and give customers accurate
                arrival estimates. Location tracking stops outside those hours.
              </li>
              <li>
                <strong className="text-foreground">
                  Contact form messages.
                </strong>{" "}
                If you use our contact form, we keep your name, email, optional
                phone number, and message so we can respond.
              </li>
            </ul>
          </Section>

          <Section number="3" title="How We Use Your Information">
            <ul className="list-disc pl-5 space-y-2">
              <li>To schedule, confirm, change, and dispatch cleaning appointments.</li>
              <li>To assign and route cleaners to your home efficiently.</li>
              <li>
                To capture accurate booking details from phone calls,
                including with AI-assisted transcription tools.
              </li>
              <li>To respond to your questions and support requests.</li>
              <li>To maintain business records such as invoices and service history.</li>
            </ul>
            <p>
              We do <strong className="text-foreground">not</strong> sell your
              personal information to anyone.
            </p>
          </Section>

          <Section number="4" title="How We Share Information">
            <p>
              We share information only with service providers that help us run
              the business, such as our scheduling and invoicing platform, our
              telephone service provider, and our secure cloud hosting
              provider. These providers may only use your information to
              provide services to us.
            </p>
          </Section>

          <Section number="5" title="Data Retention">
            <p>
              We keep booking records and related transcripts for as long as
              needed to provide service and meet legal and accounting
              obligations. Cleaner GPS locations are kept only as current
              positions used for live dispatching — historical location trails
              are not stored.
            </p>
          </Section>

          <Section number="6" title="Security">
            <p>
              Your information is stored in access-controlled systems. Only
              authorized dispatch staff can view customer records, and cleaner
              accounts can only see the jobs assigned to them. We use encrypted
              connections (HTTPS) for all data in transit.
            </p>
          </Section>

          <Section number="7" title="Your Choices & Rights">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                You may ask us to correct or update your contact and booking
                information at any time.
              </li>
              <li>
                You may request a copy of the personal information we hold
                about you, or ask us to delete it (subject to records we're
                legally required to keep).
              </li>
              <li>
                If you'd prefer your calls not be transcribed, let the
                dispatcher know at the start of the call and we'll take your
                booking manually.
              </li>
            </ul>
          </Section>

          <Section number="8" title="Changes to This Policy">
            <p>
              We may update this policy from time to time. Material changes
              will be reflected by the "Last updated" date at the top of this
              page.
            </p>
          </Section>

          <Section number="9" title="Contact Us">
            <p>
              Questions about this policy or your data? Reach us at{" "}
              <a
                href={`mailto:${COMPANY_EMAIL}`}
                className="text-primary font-medium hover:underline"
              >
                {COMPANY_EMAIL}
              </a>
              , call {COMPANY_PHONE_DISPLAY}, or{" "}
              <Link href="/contact" className="text-primary font-medium hover:underline">
                send us a message
              </Link>
              .
            </p>
          </Section>
        </CardContent>
      </Card>
    </PublicPage>
  );
}

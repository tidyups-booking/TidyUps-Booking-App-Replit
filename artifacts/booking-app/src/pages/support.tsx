import { Link } from "wouter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, Mail, MessageCircle, LifeBuoy } from "lucide-react";
import {
  PublicPage,
  PublicPageHero,
} from "@/components/public-page";
import {
  COMPANY_PHONE,
  COMPANY_PHONE_DISPLAY,
  COMPANY_EMAIL,
} from "@/components/footer";
import livingRoomImg from "@assets/brand-doc/branded-living-room.jpg";

const FAQS = [
  {
    q: "How do I change or reschedule my booking?",
    a: "Call or email us at least 24 hours before your scheduled clean and we'll happily move it to a time that works better. Have your name and booking date handy so our dispatch team can find your appointment quickly.",
  },
  {
    q: "What is your cancellation policy?",
    a: "You can cancel free of charge up to 24 hours before your appointment. Cancellations with less than 24 hours' notice may be subject to a fee, since your cleaner has already reserved that time for you.",
  },
  {
    q: "When will my cleaner arrive?",
    a: "Your booking confirmation includes a scheduled start time. Cleaners typically arrive within a 30-minute window around that time to allow for travel between homes. If your cleaner is running late, our dispatch team will let you know.",
  },
  {
    q: "What's included in a standard clean?",
    a: "A standard clean covers all main living areas: dusting, vacuuming, mopping, kitchen counters and appliances (outside), bathrooms, and trash removal. Deep cleans, move-in/move-out cleans, and post-construction cleans include additional detail work — ask us for a full checklist.",
  },
  {
    q: "Do I need to be home during the clean?",
    a: "No — many of our customers provide entry instructions (door code, lockbox, or concierge). If you prefer to be home, that's perfectly fine too. Just let us know your preference when booking.",
  },
  {
    q: "How is my quoted price determined?",
    a: "Pricing is based on the type of service, the number of bedrooms and bathrooms, and any extras you add (like inside-oven or inside-fridge cleaning). The price quoted at booking is what you pay unless the scope changes on the day.",
  },
  {
    q: "What if I'm not happy with my clean?",
    a: "Let us know within 24 hours and we'll make it right — usually with a free re-clean of the areas in question. Your satisfaction is our priority.",
  },
];

export default function SupportPage() {
  return (
    <PublicPage
      title="Support"
      description="Frequently asked questions and help for 833 Tidyups customers — booking changes, cancellations, arrival windows, and more."
    >
      <PublicPageHero
        eyebrow="Help Center"
        title="How can we help?"
        subtitle="Answers to the questions we hear most often. Can't find what you're looking for? Our team is one call or message away."
      />

      <img
        src={livingRoomImg}
        alt="A freshly cleaned living room by 833 Tidyups"
        className="w-full rounded-2xl shadow-sm border mb-10 aspect-[5/2] object-cover object-left-top"
        loading="lazy"
      />

      <Card className="shadow-sm border-t-4 border-t-primary">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <LifeBuoy className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold">Frequently Asked Questions</h2>
          </div>
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left font-medium">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Still need help */}
      <div className="mt-10 rounded-2xl brand-gradient p-[1.5px] shadow-md shadow-primary/20">
        <div className="rounded-2xl bg-card px-6 py-8 text-center">
          <MessageCircle className="w-8 h-8 text-primary mx-auto mb-3" />
          <h2 className="text-2xl font-bold brand-gradient-text pb-1">
            Still need help?
          </h2>
          <p className="text-muted-foreground mt-2 max-w-md mx-auto">
            Our dispatch team is available during business hours and always
            happy to help with anything not covered above.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/contact">
              <Button className="gap-2 w-full sm:w-auto">
                <Mail className="w-4 h-4" />
                Send us a message
              </Button>
            </Link>
            <a href={`tel:${COMPANY_PHONE}`}>
              <Button variant="outline" className="gap-2 w-full sm:w-auto">
                <Phone className="w-4 h-4" />
                {COMPANY_PHONE_DISPLAY}
              </Button>
            </a>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Or email us anytime at{" "}
            <a
              href={`mailto:${COMPANY_EMAIL}`}
              className="text-primary font-medium hover:underline"
            >
              {COMPANY_EMAIL}
            </a>
          </p>
        </div>
      </div>
    </PublicPage>
  );
}

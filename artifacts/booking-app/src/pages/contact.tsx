import React, { useState } from "react";
import { useSubmitContactMessage } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Phone, Mail, Clock, CheckCircle2, Send } from "lucide-react";
import { PublicPage, PublicPageHero } from "@/components/public-page";
import {
  COMPANY_PHONE,
  COMPANY_PHONE_DISPLAY,
  COMPANY_EMAIL,
  COMPANY_HOURS,
} from "@/components/footer";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function ContactPage() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot: hidden from humans; bots that auto-fill it get silently dropped.
  const [website, setWebsite] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const mutation = useSubmitContactMessage({
    mutation: {
      onSuccess: () => {
        setSubmitted(true);
        toast({
          title: "Message received!",
          description: "Thanks for reaching out — we'll get back to you soon.",
        });
      },
      onError: (error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status === 429) {
          toast({
            title: "Too many messages",
            description:
              "You've sent several messages recently. Please wait a few minutes and try again, or call us directly.",
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "Something went wrong",
          description:
            "We couldn't send your message. Please try again, or call us directly.",
          variant: "destructive",
        });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !message.trim()) {
      toast({
        title: "Missing information",
        description: "Please fill in your name and a message.",
        variant: "destructive",
      });
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address so we can reply.",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate({
      data: {
        name: name.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        message: message.trim(),
        ...(website ? { website } : {}),
      },
    });
  };

  return (
    <PublicPage
      title="Contact"
      description="Get in touch with 833 Tidyups — call, email, or send us a message and our team will get back to you."
    >
      <PublicPageHero
        eyebrow="Contact Us"
        title="We'd love to hear from you"
        subtitle="Questions about a booking, a quote, or anything else? Reach out any way that suits you."
      />

      <div className="grid gap-6 md:grid-cols-5">
        {/* Contact details */}
        <div className="md:col-span-2 space-y-4">
          <Card className="shadow-sm">
            <CardContent className="pt-6 space-y-5">
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 rounded-lg p-2.5 border border-primary/20">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">Phone</p>
                  <a
                    href={`tel:${COMPANY_PHONE}`}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {COMPANY_PHONE_DISPLAY}
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 rounded-lg p-2.5 border border-primary/20">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">Email</p>
                  <a
                    href={`mailto:${COMPANY_EMAIL}`}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors break-all"
                  >
                    {COMPANY_EMAIL}
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 rounded-lg p-2.5 border border-primary/20">
                  <Clock className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">Service Hours</p>
                  <div className="text-sm text-muted-foreground">
                    {COMPANY_HOURS.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground px-1">
            For urgent same-day changes to a booking, please call us — it's the
            fastest way to reach dispatch.
          </p>
        </div>

        {/* Message form */}
        <Card className="md:col-span-3 shadow-sm border-t-4 border-t-primary">
          <CardHeader>
            <CardTitle className="text-xl">Send us a message</CardTitle>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="py-10 text-center animate-in fade-in duration-300">
                <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
                <h3 className="text-2xl font-bold">Message received!</h3>
                <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                  Thanks for reaching out, {name.trim().split(" ")[0]}. Our team
                  will get back to you at <strong>{email.trim()}</strong> as
                  soon as possible.
                </p>
                <Button
                  variant="outline"
                  className="mt-6"
                  onClick={() => {
                    setSubmitted(false);
                    setName("");
                    setEmail("");
                    setPhone("");
                    setMessage("");
                  }}
                >
                  Send another message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Honeypot — invisible to humans, catches bots that fill every field */}
                <div
                  aria-hidden="true"
                  className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
                >
                  <label htmlFor="contact-website">Website</label>
                  <input
                    id="contact-website"
                    name="website"
                    type="text"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="contact-name">Name *</Label>
                    <Input
                      id="contact-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-email">Email *</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      maxLength={320}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-phone">Phone (optional)</Label>
                  <Input
                    id="contact-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    maxLength={40}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-message">Message *</Label>
                  <Textarea
                    id="contact-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="How can we help?"
                    className="min-h-[140px]"
                    maxLength={5000}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full gap-2"
                  isLoading={mutation.isPending}
                >
                  {!mutation.isPending && <Send className="w-4 h-4" />}
                  Send Message
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </PublicPage>
  );
}

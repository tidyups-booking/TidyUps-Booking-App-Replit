import React, { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/footer";
import logoImg from "@assets/833tidyups-logo.png";

/**
 * Shell for public informational pages (Support, Contact, Privacy).
 * No auth required — renders a lightweight header, the page content,
 * and the shared site footer.
 */
export function PublicPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${title} — 833 Tidyups`;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDescription = meta?.content;
    if (description) {
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "description";
        document.head.appendChild(meta);
      }
      meta.content = description;
    }

    return () => {
      document.title = prevTitle;
      if (description && meta && prevDescription !== undefined) {
        meta.content = prevDescription;
      }
    };
  }, [title, description]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 transition-opacity hover:opacity-80"
          >
            <img
              src={logoImg}
              alt="833 Tidyups Logo"
              className="h-10 w-10 object-contain rounded-md"
            />
            <span className="font-serif font-bold text-xl tracking-tight text-foreground">
              833 Tidyups
            </span>
          </Link>
          <Link href="/sign-in">
            <Button size="sm">Sign In</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full">
        <div className="container mx-auto px-4 py-10 md:py-14 max-w-4xl">
          {children}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

/** Consistent hero heading for public pages. */
export function PublicPageHero({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-10 text-center animate-in fade-in duration-500">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-2 font-sans">
        {eyebrow}
      </p>
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight brand-gradient-text pb-1">
        {title}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">{subtitle}</p>
      <span className="mt-5 block h-1 w-24 brand-gradient rounded-full mx-auto" />
    </div>
  );
}

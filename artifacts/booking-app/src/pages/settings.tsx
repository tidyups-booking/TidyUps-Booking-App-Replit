import React from "react";
import {
  useListSocialLinks,
  useCreateSocialLink,
  useUpdateSocialLink,
  useDeleteSocialLink,
  getListSocialLinksQueryKey,
} from "@workspace/api-client-react";
import type { SocialLink } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Globe, Trash2, Plus, Check, Share2 } from "lucide-react";
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

function LinkRow({ link }: { link: SocialLink }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [url, setUrl] = React.useState(link.url);
  const dirty = url.trim() !== link.url;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSocialLinksQueryKey() });

  const update = useUpdateSocialLink({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: `${link.label} link saved` });
      },
      onError: (err) =>
        toast({
          title: `Could not save ${link.label}`,
          description: err.data?.error,
          variant: "destructive",
        }),
    },
  });

  const remove = useDeleteSocialLink({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: `${link.label} removed` });
      },
      onError: () =>
        toast({ title: `Could not remove ${link.label}`, variant: "destructive" }),
    },
  });

  const Icon = SOCIAL_ICONS[link.platform] ?? Globe;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-3 border-b last:border-b-0">
      <div className="flex items-center gap-3 sm:w-44 shrink-0">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0">
          <Icon className="h-4 w-4" />
        </span>
        <span className="font-medium text-sm">{link.label}</span>
      </div>
      <div className="flex flex-1 items-center gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={`https://... (blank hides ${link.label} from the site)`}
          className="flex-1"
        />
        <Button
          size="sm"
          disabled={!dirty || update.isPending}
          onClick={() => update.mutate({ id: link.id, data: { url: url.trim() } })}
        >
          <Check className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Save</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Remove ${link.label} from the site footer?`)) {
              remove.mutate({ id: link.id });
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AddLinkForm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [label, setLabel] = React.useState("");
  const [url, setUrl] = React.useState("");

  const create = useCreateSocialLink({
    mutation: {
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: getListSocialLinksQueryKey() });
        toast({ title: `${created.label} added` });
        setLabel("");
        setUrl("");
      },
      onError: (err) =>
        toast({
          title: "Could not add link",
          description: err.data?.error,
          variant: "destructive",
        }),
    },
  });

  return (
    <div className="flex flex-col sm:flex-row gap-2 pt-4">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Platform name (e.g. LinkedIn)"
        className="sm:w-44"
      />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://..."
        className="flex-1"
      />
      <Button
        disabled={label.trim() === "" || create.isPending}
        onClick={() => create.mutate({ data: { label: label.trim(), url: url.trim() } })}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add
      </Button>
    </div>
  );
}

export default function SettingsPage() {
  const { data: links, isLoading, isError } = useListSocialLinks();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage what visitors see across the site.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            Social Media Links
          </CardTitle>
          <CardDescription>
            These appear as icons in the footer on every page. Leave a link
            blank to hide it without deleting it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}
          {isError && (
            <p className="text-sm text-destructive py-4">
              Could not load social links. Try refreshing the page.
            </p>
          )}
          {links && links.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">
              No links yet — add your first one below.
            </p>
          )}
          {links?.map((link) => <LinkRow key={link.id} link={link} />)}
          <AddLinkForm />
        </CardContent>
      </Card>
    </div>
  );
}

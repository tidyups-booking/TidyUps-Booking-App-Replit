import { useEffect, useRef } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import {
  Switch,
  Route,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import BookingsList from "@/pages/bookings";
import NewBooking from "@/pages/new-booking";
import BookingDetail from "@/pages/booking-detail";
import Schedule from "@/pages/schedule";
import StaffManagement from "@/pages/staff";
import MapPage from "@/pages/map";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

// REQUIRED — resolves key from hostname so the same build works across
// dev + production + custom domains. Do NOT inline the env var directly.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — empty string in dev (intentional), auto-set in prod. Do NOT
// gate on import.meta.env.PROD — the empty dev value is correct.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

// ── Brand appearance (833 Tidyups: hot pink #EE3FCE, deep purple #8870C4) ──
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: "#EE3FCE",
    colorForeground: "#171717",
    colorMutedForeground: "#737380",
    colorDanger: "#EF4444",
    colorBackground: "#FAFAFA",
    colorInput: "#F5F5F8",
    colorInputForeground: "#171717",
    colorNeutral: "#E5E5EF",
    fontFamily: "'Poppins', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl shadow-pink-500/10 border border-pink-100",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-bold text-[#171717]",
    headerSubtitle: "text-[#737380]",
    socialButtonsBlockButtonText: "text-[#171717] font-medium",
    formFieldLabel: "text-[#171717] font-medium",
    footerActionLink: "text-[#EE3FCE] font-semibold",
    footerActionText: "text-[#737380]",
    dividerText: "text-[#737380]",
    identityPreviewEditButton: "text-[#EE3FCE]",
    formFieldSuccessText: "text-green-600",
    alertText: "text-[#171717]",
    logoBox: "flex justify-center py-2",
    logoImage: "h-10 w-auto",
    socialButtonsBlockButton:
      "border border-[#E5E5EF] hover:border-[#EE3FCE]/30 transition-colors",
    formButtonPrimary:
      "bg-[#EE3FCE] hover:bg-[#d935b9] text-white font-semibold transition-colors",
    formFieldInput: "bg-[#F5F5F8] border-[#E5E5EF] focus:ring-[#EE3FCE]",
    footerAction: "bg-[#FAFAFA]",
    dividerLine: "bg-[#E5E5EF]",
    alert: "bg-red-50 border-red-200",
    otpCodeFieldInput: "border-[#E5E5EF] focus:ring-[#EE3FCE]",
    formFieldRow: "mb-1",
    main: "p-1",
  },
};

// ── Sign-in / Sign-up pages ──────────────────────────────────────────────────

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-pink-50 via-white to-purple-50 px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-pink-50 via-white to-purple-50 px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

// ── Landing page for signed-out visitors ────────────────────────────────────

function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-4 gap-8 overflow-hidden">
      {/* Vehicle background */}
      <div className="absolute inset-0 z-0">
        <img
          src={`${basePath}/vehicle.jpg`}
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-pink-900/70 via-purple-900/60 to-black/70" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        <img
          src={`${basePath}/logo.png`}
          alt="833 Tidyups"
          className="h-32 w-32 object-contain rounded-2xl shadow-2xl shadow-black/40"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-white drop-shadow-lg">
            833 Tidyups
          </h1>
          <p className="text-xl font-semibold text-pink-200">Dispatch Portal</p>
          <p className="text-white/70">Staff access only — sign in to continue</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <button
            onClick={() => setLocation("/sign-in")}
            className="bg-primary text-white font-semibold px-10 py-4 rounded-xl text-lg hover:bg-primary/90 transition-all shadow-xl shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5"
          >
            Sign In to Dispatch
          </button>
          <a
            href="/cleaner-app/"
            className="bg-white/10 backdrop-blur border border-white/30 text-white font-semibold px-10 py-4 rounded-xl text-lg hover:bg-white/20 transition-all shadow-xl shadow-black/20 hover:-translate-y-0.5"
          >
            Cleaner Sign In
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Home: dashboard for signed-in, landing for signed-out ───────────────────

function HomeRoute() {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Dashboard />
        </Layout>
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

// ── Generic protected route wrapper ─────────────────────────────────────────

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

// ── Cache invalidation on user change ───────────────────────────────────────

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

// ── Root: ClerkProvider wraps the whole router ───────────────────────────────

function AppRouter() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to 833 Tidyups Dispatch",
          },
        },
        signUp: {
          start: {
            title: "Create account",
            subtitle: "Join 833 Tidyups Dispatch",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route path="/" component={HomeRoute} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/new">
              <ProtectedRoute component={NewBooking} />
            </Route>
            <Route path="/bookings">
              <ProtectedRoute component={BookingsList} />
            </Route>
            <Route path="/bookings/:id">
              <ProtectedRoute component={BookingDetail} />
            </Route>
            <Route path="/schedule">
              <ProtectedRoute component={Schedule} />
            </Route>
            <Route path="/staff">
              <ProtectedRoute component={StaffManagement} />
            </Route>
            <Route path="/map">
              <ProtectedRoute component={MapPage} />
            </Route>
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRouter />
    </WouterRouter>
  );
}

export default App;

/**
 * Jobber API service — OAuth token management + GraphQL helpers.
 * Tokens are stored in the jobber_tokens table (single row, always upserted).
 */

import { db, jobberTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JOBBER_API_BASE = "https://api.getjobber.com/api";
const JOBBER_GRAPHQL = `${JOBBER_API_BASE}/graphql`;
const JOBBER_VERSION = "2024-11-15";

function getClientId() {
  const id = process.env.JOBBER_CLIENT_ID;
  if (!id) throw new Error("JOBBER_CLIENT_ID not set");
  return id;
}

function getClientSecret() {
  const s = process.env.JOBBER_CLIENT_SECRET;
  if (!s) throw new Error("JOBBER_CLIENT_SECRET not set");
  return s;
}

/**
 * Build the Jobber OAuth callback URL.
 * Prefer the host derived from the live request so it works on any domain
 * (dev .replit.dev, production .replit.app, custom domain, etc.).
 * Falls back to REPLIT_DEV_DOMAIN for contexts where no request is available.
 */
export function getCallbackUrl(host?: string) {
  const h = host ?? process.env.REPLIT_DEV_DOMAIN;
  if (!h) throw new Error("Cannot determine callback host — REPLIT_DEV_DOMAIN not set");
  // host from req.get('host') already includes the port when non-standard;
  // always use https since Replit proxies terminate TLS.
  return `https://${h}/api/jobber/callback`;
}

// ── Token storage ─────────────────────────────────────────────────────────────

export async function getStoredTokens() {
  const rows = await db.select().from(jobberTokensTable).limit(1);
  return rows[0] ?? null;
}

export async function upsertTokens(data: {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  expiresIn?: number; // seconds
}) {
  const expiresAt = data.expiresIn
    ? new Date(Date.now() + data.expiresIn * 1000)
    : null;

  const existing = await getStoredTokens();

  if (existing) {
    await db
      .update(jobberTokensTable)
      .set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenType: data.tokenType ?? "Bearer",
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(jobberTokensTable.id, existing.id));
  } else {
    await db.insert(jobberTokensTable).values({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenType: data.tokenType ?? "Bearer",
      expiresAt,
    });
  }
}

// ── OAuth token exchange ──────────────────────────────────────────────────────

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${JOBBER_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jobber token exchange failed (${res.status}): ${text}`);
  }

  const json = await res.json() as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };

  await upsertTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenType: json.token_type,
    expiresIn: json.expires_in,
  });

  return json;
}

async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(`${JOBBER_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jobber token refresh failed (${res.status}): ${text}`);
  }

  const json = await res.json() as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };

  await upsertTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenType: json.token_type,
    expiresIn: json.expires_in,
  });

  return json.access_token;
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = await getStoredTokens();
  if (!tokens) throw new Error("Jobber not connected — no tokens stored");

  // Refresh if expires within 5 minutes
  const needsRefresh =
    tokens.expiresAt &&
    tokens.expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

  if (needsRefresh) {
    return refreshAccessToken(tokens.refreshToken);
  }

  return tokens.accessToken;
}

// ── GraphQL helper ────────────────────────────────────────────────────────────

export async function jobberGQL<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const token = await getValidAccessToken();

  const res = await fetch(JOBBER_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jobber GraphQL HTTP error (${res.status}): ${text}`);
  }

  const json = await res.json() as { data?: T; errors?: any[] };

  if (json.errors?.length) {
    throw new Error(`Jobber GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// ── Sync a booking → Jobber request ──────────────────────────────────────────

interface BookingForSync {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  address: string;
  city: string;
  province: string;
  postalCode?: string | null;
  serviceType: string;
  bedrooms: number;
  bathrooms: number;
  extras: string[];
  scheduledDate: string;
  scheduledTime: string;
  notes?: string | null;
  estimatedPrice?: number | null;
}

const SERVICE_LABELS: Record<string, string> = {
  standard_clean: "Standard Clean",
  deep_clean: "Deep Clean",
  move_in_out: "Move In/Out Clean",
  post_construction: "Post-Construction Clean",
};

async function findOrCreateClient(booking: BookingForSync): Promise<string> {
  // Search by name
  const searchResult = await jobberGQL<{
    clients: { nodes: Array<{ id: string; firstName: string; lastName: string }> };
  }>(
    `query SearchClients($filter: ClientFilterAttributes) {
      clients(filter: $filter) {
        nodes { id firstName lastName }
      }
    }`,
    { filter: { searchTerm: `${booking.firstName} ${booking.lastName}` } }
  );

  const match = searchResult.clients.nodes.find(
    (c) =>
      c.firstName.toLowerCase() === booking.firstName.toLowerCase() &&
      c.lastName.toLowerCase() === booking.lastName.toLowerCase()
  );

  if (match) return match.id;

  // Create new client
  const phones = [{ number: booking.phone, primary: true, smsAllowed: false }];
  const emails = booking.email
    ? [{ address: booking.email, primary: true }]
    : [];

  const createResult = await jobberGQL<{
    clientCreate: {
      client: { id: string } | null;
      userErrors: Array<{ message: string; path: string[] }>;
    };
  }>(
    `mutation ClientCreate($input: ClientCreateInput!) {
      clientCreate(input: $input) {
        client { id }
        userErrors { message path }
      }
    }`,
    {
      input: {
        firstName: booking.firstName,
        lastName: booking.lastName,
        phones,
        emails,
        billingAddress: {
          street: booking.address,
          city: booking.city,
          province: booking.province,
          postalCode: booking.postalCode ?? "",
          country: "Canada",
        },
      },
    }
  );

  const { client, userErrors } = createResult.clientCreate;
  if (userErrors.length > 0) {
    throw new Error(`Jobber clientCreate errors: ${userErrors.map((e) => e.message).join(", ")}`);
  }
  if (!client) throw new Error("Jobber clientCreate returned no client");

  return client.id;
}

export async function syncBookingToJobber(booking: BookingForSync): Promise<string> {
  const clientId = await findOrCreateClient(booking);

  const serviceLabel = SERVICE_LABELS[booking.serviceType] ?? booking.serviceType;
  const extrasText = booking.extras.length > 0 ? ` + ${booking.extras.join(", ")}` : "";
  const title = `${serviceLabel}${extrasText} — ${booking.bedrooms}bd/${booking.bathrooms}ba`;

  const instructionsParts = [
    `Scheduled: ${booking.scheduledDate} at ${booking.scheduledTime}`,
    booking.notes ? `Notes: ${booking.notes}` : null,
    booking.estimatedPrice ? `Quoted: $${booking.estimatedPrice}` : null,
  ].filter(Boolean);

  const result = await jobberGQL<{
    requestCreate: {
      request: { id: string; jobberWebUri?: string } | null;
      userErrors: Array<{ message: string; path: string[] }>;
    };
  }>(
    `mutation RequestCreate($input: RequestCreateInput!) {
      requestCreate(input: $input) {
        request { id jobberWebUri }
        userErrors { message path }
      }
    }`,
    {
      input: {
        clientId,
        title,
        instructions: instructionsParts.join("\n"),
        property: {
          street: booking.address,
          city: booking.city,
          province: booking.province,
          postalCode: booking.postalCode ?? "",
          country: "Canada",
        },
      },
    }
  );

  const { request, userErrors } = result.requestCreate;
  if (userErrors.length > 0) {
    throw new Error(`Jobber requestCreate errors: ${userErrors.map((e) => e.message).join(", ")}`);
  }
  if (!request) throw new Error("Jobber requestCreate returned no request");

  return request.id;
}

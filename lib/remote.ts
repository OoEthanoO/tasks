import { sanitizeState } from "./app-state";
import { AppState, User } from "./types";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Where the API lives. The web app talks to its own origin, so the default is
 * the empty string and every path stays relative. A native client has no
 * origin of its own and points this at the deployment once, on startup.
 */
let apiBase = "";

export function setApiBase(base: string): void {
  apiBase = base.replace(/\/+$/, "");
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}${url}`, {
      ...init,
      // The session is an httpOnly cookie: the browser attaches it to a
      // same-origin request on its own, and iOS keeps a persistent cookie
      // store per domain that does the same for the native client.
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Could not reach the server.", 0);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // A body-less response is fine for the endpoints that return {ok:true}.
  }

  if (!res.ok) {
    // A 5xx never carries our JSON body — it is a crash, not a rejection — so
    // say something truer than "something went wrong". The cause is in the
    // server logs; it deliberately does not travel to the browser.
    const fallback =
      res.status >= 500
        ? "The server had a problem. Please try again in a moment."
        : "Something went wrong.";
    const message = (body as { error?: string } | null)?.error ?? fallback;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export type AuthResult = { user: User; state: AppState; migrated?: boolean };

export const api = {
  async me(): Promise<User | null> {
    const body = await request<{ user: User | null }>("/api/auth/me");
    return body.user;
  },

  async signUp(input: {
    username: string;
    password: string;
    importState: AppState | null;
  }): Promise<AuthResult> {
    const body = await request<AuthResult>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        importState: input.importState,
      }),
    });
    return { ...body, state: sanitizeState(body.state) };
  },

  async signIn(username: string, password: string): Promise<AuthResult> {
    const body = await request<AuthResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    return { ...body, state: sanitizeState(body.state) };
  },

  async signOut(): Promise<void> {
    await request<{ ok: true }>("/api/auth/logout", { method: "POST" });
  },

  async loadState(): Promise<AppState> {
    const body = await request<{ state: AppState }>("/api/state");
    return sanitizeState(body.state);
  },

  async saveState(
    state: AppState,
    opts: { keepalive?: boolean } = {},
  ): Promise<void> {
    await request<{ ok: true }>("/api/state", {
      method: "PUT",
      body: JSON.stringify({ state }),
      // Set when flushing on page hide, so the write survives the navigation.
      keepalive: opts.keepalive,
    });
  },
};

// Credential rules shared by the browser and the server. Kept free of any node
// imports so a client component can pre-validate with the exact same logic the
// API enforces.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

const USERNAME_SHAPE = /^[a-zA-Z0-9._-]+$/;

export function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < USERNAME_MIN) {
    return `Username must be at least ${USERNAME_MIN} characters.`;
  }
  if (trimmed.length > USERNAME_MAX) {
    return `Username must be at most ${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_SHAPE.test(trimmed)) {
    return "Username can only use letters, numbers, dot, dash and underscore.";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters.`;
  }
  return null;
}

/** Usernames are case-insensitive for lookup but keep their typed casing. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** 本地鉴权 Token 存储（AUTH_MODE=password 时使用） */

const STORAGE_KEY = "kp-auth-token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

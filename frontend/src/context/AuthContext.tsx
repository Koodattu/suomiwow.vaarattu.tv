"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { AuthUser } from "@/types";
import { api } from "@/lib/api";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (returnTo?: string, options?: { ccgOpeningId?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const POST_LOGIN_RETURN_TO_KEY = "post-login-return-to";
const PENDING_CCG_CLAIM_KEY = "pending-ccg-guest-claim";

type PendingCcgClaim = { openingId: string; idempotencyKey: string };

function normalizeSafeInternalPath(value: string): string | null {
  if (typeof window === "undefined" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }

  try {
    const resolvedUrl = new URL(value, window.location.origin);
    if (resolvedUrl.origin !== window.location.origin) return null;
    return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
  } catch {
    return null;
  }
}

function storePostLoginReturnTo(returnTo?: string): void {
  if (typeof window === "undefined") return;

  try {
    const safeReturnTo = returnTo ? normalizeSafeInternalPath(returnTo) : null;
    if (safeReturnTo) {
      window.sessionStorage.setItem(POST_LOGIN_RETURN_TO_KEY, safeReturnTo);
    } else {
      window.sessionStorage.removeItem(POST_LOGIN_RETURN_TO_KEY);
    }
  } catch {
    // Login still works when browser storage is unavailable.
  }
}

function consumePostLoginReturnTo(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const returnTo = window.sessionStorage.getItem(POST_LOGIN_RETURN_TO_KEY);
    window.sessionStorage.removeItem(POST_LOGIN_RETURN_TO_KEY);
    return returnTo;
  } catch {
    return null;
  }
}

function storePendingCcgClaim(openingId?: string): void {
  if (typeof window === "undefined" || !openingId) return;
  try {
    const pending: PendingCcgClaim = {
      openingId,
      idempotencyKey: `login_${window.crypto.randomUUID()}`,
    };
    window.sessionStorage.setItem(PENDING_CCG_CLAIM_KEY, JSON.stringify(pending));
  } catch {
    // Login still works when browser storage is unavailable.
  }
}

function readPendingCcgClaim(): PendingCcgClaim | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_CCG_CLAIM_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingCcgClaim>;
    return typeof pending.openingId === "string" && typeof pending.idempotencyKey === "string"
      ? { openingId: pending.openingId, idempotencyKey: pending.idempotencyKey }
      : null;
  } catch {
    return null;
  }
}

function clearPendingCcgClaim(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_CCG_CLAIM_KEY);
  } catch {
    // Nothing else needs to happen when browser storage is unavailable.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await api.getCurrentUser();
      setUser(currentUser);

      if (currentUser && typeof window !== "undefined") {
        const pendingCcgClaim = readPendingCcgClaim();
        if (pendingCcgClaim) {
          try {
            await api.claimCcgGuest(pendingCcgClaim.openingId, pendingCcgClaim.idempotencyKey);
          } catch (error) {
            console.warn("The selected guest pack could not be claimed:", error);
          } finally {
            clearPendingCcgClaim();
          }
        }
        const returnTo = consumePostLoginReturnTo();
        const safeReturnTo = returnTo ? normalizeSafeInternalPath(returnTo) : null;
        const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (safeReturnTo && currentPath !== safeReturnTo) {
          window.location.replace(safeReturnTo);
        }
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      await refreshUser();
      setIsLoading(false);
    };
    initAuth();
  }, [refreshUser]);

  const login = async (returnTo?: string, options?: { ccgOpeningId?: string }) => {
    try {
      storePostLoginReturnTo(returnTo);
      storePendingCcgClaim(options?.ccgOpeningId);
      const { url } = await api.getDiscordLoginUrl();
      window.location.href = url;
    } catch (error) {
      storePostLoginReturnTo();
      if (options?.ccgOpeningId) clearPendingCcgClaim();
      console.error("Failed to get login URL:", error);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
      setUser(null);
    } catch (error) {
      console.error("Failed to logout:", error);
    }
  };

  return <AuthContext.Provider value={{ user, isLoading, login, logout, refreshUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

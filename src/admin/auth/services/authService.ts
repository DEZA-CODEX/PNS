import type { CreateAccountFormData, LoginFormData } from "../types";
import { apiFetch } from "@/lib/api-client";

export type AuthApiResult = {
  success: boolean;
  message?: string;
  user?: { id: string; email: string; displayName: string; roleName: string };
};

export const passwordRules = [
  { label: "Minimum 8 characters", test: (value: string) => value.length >= 8 },
  { label: "One uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "One lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { label: "One number", test: (value: string) => /\d/.test(value) },
] as const;

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validatePasswordRequirements(password: string) {
  return passwordRules.map((rule) => ({
    ...rule,
    valid: rule.test(password),
  }));
}

export const authService = {
  async login(payload: LoginFormData): Promise<AuthApiResult> {
    const response = await apiFetch("/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as {
      success?: boolean;
      user?: AuthApiResult["user"];
      error?: { message?: string };
    };
    if (!response.ok)
      return { success: false, message: body.error?.message ?? "Invalid email or password." };
    return body.user
      ? { success: true, user: body.user, message: "Signed in successfully." }
      : { success: true, message: "Signed in successfully." };
  },

  async logout(): Promise<AuthApiResult> {
    const response = await apiFetch("/admin/auth/logout", { method: "POST" });
    return response.ok
      ? { success: true }
      : { success: false, message: "Sign-out is temporarily unavailable." };
  },

  async createAccount(payload: CreateAccountFormData): Promise<AuthApiResult> {
    void payload;
    return {
      success: false,
      message: "Only an authenticated administrator can create accounts.",
    };
  },

  async requestPasswordReset(email: string): Promise<AuthApiResult> {
    await new Promise((resolve) => window.setTimeout(resolve, 450));

    if (!isValidEmail(email)) {
      return { success: false, message: "Please enter a valid email address." };
    }

    return {
      success: true,
      message: "If this account is registered, a reset link will be sent to your email.",
    };
  },
};

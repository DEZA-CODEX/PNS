import { AdminAuthError } from "@/lib/admin-auth";

export function adminErrorResponse(error: unknown, requestId?: string) {
  if (error instanceof AdminAuthError) {
    return Response.json(
      { success: false, requestId, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error("admin API failure", error instanceof Error ? error.message : "unknown error");
  return Response.json(
    {
      success: false,
      requestId,
      error: { code: "server_error", message: "The request could not be completed." },
    },
    { status: 500 },
  );
}

export function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminAuthError("validation", `${field} is required.`, 400);
  }
  return value.trim();
}

/** Validate a password without trimming or otherwise changing user input. */
export function requirePassword(value: unknown, field = "Password") {
  if (typeof value !== "string" || value.length === 0) {
    throw new AdminAuthError("validation", `${field} is required.`, 400);
  }
  return value;
}

import {
  AdminAuthError,
  getAdminDb,
  hashPassword,
  invalidateAdminSessions,
  requirePermission,
  writeAuditEvent,
} from "@/lib/admin-auth";
import { adminErrorResponse, requirePassword, requireText } from "@/lib/admin-api";

export const runtime = "nodejs";

async function getUser(userId: string) {
  const { data, error } = await getAdminDb()
    .from("admin_users")
    .select(
      "id,email,display_name,status,created_at,updated_at,last_login_at,role:admin_roles(name)",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    await requirePermission(request, "users.read");
    const { userId } = await context.params;
    const db = getAdminDb();
    const user = await getUser(userId);
    if (!user)
      return Response.json(
        { success: false, error: { code: "not_found", message: "User not found." } },
        { status: 404 },
      );
    const [{ data: memberships, error: membershipsError }, { data: direct, error: directError }] =
      await Promise.all([
        db
          .from("admin_user_groups")
          .select("group:admin_groups(id,name,description,is_active)")
          .eq("user_id", userId),
        db
          .from("admin_user_permissions")
          .select("effect,permission:admin_permissions(permission_key,label,area)")
          .eq("user_id", userId),
      ]);
    if (membershipsError) throw membershipsError;
    if (directError) throw directError;
    return Response.json({
      success: true,
      user,
      memberships: memberships ?? [],
      directPermissions: direct ?? [],
      requestId,
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { userId } = await context.params;
    const actor = await requirePermission(request, "users.update");
    const body = (await request.json()) as {
      displayName?: unknown;
      password?: unknown;
      status?: unknown;
    };
    const db = getAdminDb();
    const existing = await getUser(userId);
    if (!existing)
      return Response.json(
        { success: false, error: { code: "not_found", message: "User not found." } },
        { status: 404 },
      );
    const roleName = (existing.role as { name?: string } | null)?.name;
    if (body.status !== undefined) {
      await requirePermission(request, "users.disable");
      if (body.status !== "active" && body.status !== "disabled") throw new Error("invalid status");
      if (body.status === "disabled" && roleName === "Super Admin") {
        const { count, error } = await db
          .from("admin_users")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .eq(
            "role_id",
            (await db.from("admin_roles").select("id").eq("name", "Super Admin").single()).data?.id,
          );
        if (error) throw error;
        if ((count ?? 0) <= 1)
          return Response.json(
            {
              success: false,
              requestId,
              error: {
                code: "last_super_admin",
                message: "The last active Super Admin cannot be disabled.",
              },
            },
            { status: 409 },
          );
      }
    }
    const patch: Record<string, unknown> = {};
    if (body.displayName !== undefined)
      patch["display_name"] = requireText(body.displayName, "Display name");
    if (body.password !== undefined) {
      if (actor.user.roleName !== "Super Admin") {
        throw new AdminAuthError(
          "forbidden",
          "Only a Super Admin may change user passwords.",
          403,
        );
      }
      patch["password_hash"] = await hashPassword(requirePassword(body.password));
    }
    if (body.status !== undefined) patch["status"] = body.status;
    if (!Object.keys(patch).length) throw new Error("No permitted fields were supplied.");
    const { data: user, error } = await db
      .from("admin_users")
      .update(patch)
      .eq("id", userId)
      .select(
        "id,email,display_name,status,created_at,updated_at,last_login_at,role:admin_roles(name)",
      )
      .single();
    if (error) throw error;
    if (body.password !== undefined) await invalidateAdminSessions(userId, request);
    await writeAuditEvent(actor.user.id, "users.update", "user", userId, "success", requestId, {
      fields: Object.keys(patch).map((field) => (field === "password_hash" ? "password" : field)),
    });
    return Response.json({ success: true, user, requestId });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

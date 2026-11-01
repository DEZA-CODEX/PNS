import {
  AdminAuthError,
  hashPassword,
  requirePermission,
  getAdminDb,
  writeAuditEvent,
} from "@/lib/admin-auth";
import { adminErrorResponse, requirePassword, requireText } from "@/lib/admin-api";

export const runtime = "nodejs";

function publicUser(row: Record<string, unknown>) {
  const role = row["role"] as { name?: string } | null | undefined;
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    displayName: String(row["display_name"]),
    status: row["status"],
    roleName: role?.name ?? "Administrator",
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
    lastLoginAt: row["last_login_at"] ?? null,
  };
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requirePermission(request, "users.read");
    const search = new URL(request.url).searchParams.get("search")?.trim().toLowerCase();
    const db = getAdminDb();
    let query = db
      .from("admin_users")
      .select(
        "id,email,display_name,status,created_at,updated_at,last_login_at,role:admin_roles(name)",
      )
      .order("created_at", { ascending: false });
    if (search) query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json({
      success: true,
      users: (data ?? []).map((row) => publicUser(row)),
      requestId,
      actor: context.user.id,
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requirePermission(request, "users.create");
    const body = (await request.json()) as {
      email?: unknown;
      displayName?: unknown;
      password?: unknown;
      groupIds?: unknown;
    };
    const email = requireText(body.email, "Email").toLowerCase();
    const displayName = requireText(body.displayName, "Display name");
    const password = requirePassword(body.password);
    if (body.groupIds !== undefined) {
      if (!context.permissions.has("groups.members.manage"))
        throw new AdminAuthError(
          "forbidden",
          "You do not have permission to assign group memberships.",
          403,
        );
      if (!Array.isArray(body.groupIds) || !body.groupIds.every((id) => typeof id === "string"))
        throw new AdminAuthError("validation", "Invalid group IDs.", 400);
    }
    const passwordHash = await hashPassword(password);
    const db = getAdminDb();
    const { data: role, error: roleError } = await db
      .from("admin_roles")
      .select("id")
      .eq("name", "Administrator")
      .single();
    if (roleError) throw roleError;
    const { data: user, error } = await db
      .from("admin_users")
      .insert({ email, display_name: displayName, password_hash: passwordHash, role_id: role.id })
      .select(
        "id,email,display_name,status,created_at,updated_at,last_login_at,role:admin_roles(name)",
      )
      .single();
    if (error) {
      if (error.code === "23505")
        return Response.json(
          {
            success: false,
            requestId,
            error: { code: "conflict", message: "An account with that email already exists." },
          },
          { status: 409 },
        );
      throw error;
    }
    if (body.groupIds !== undefined) {
      if (body.groupIds.length) {
        const { error: groupError } = await db
          .from("admin_user_groups")
          .insert(body.groupIds.map((groupId) => ({ user_id: user.id, group_id: groupId })));
        if (groupError) throw groupError;
      }
    }
    await writeAuditEvent(context.user.id, "users.create", "user", user.id, "success", requestId);
    return Response.json({ success: true, user: publicUser(user), requestId }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

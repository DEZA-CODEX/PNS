import { AdminAuthError, getAdminDb, hashPassword, requirePermission, writeAuditEvent } from "@/lib/admin-auth";
import { adminErrorResponse, requirePassword, requireText } from "@/lib/admin-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await requirePermission(request, "users.create");
    if (actor.user.roleName !== "Super Admin") {
      throw new AdminAuthError(
        "forbidden",
        "Only a Super Admin may create additional Super Admin accounts.",
        403,
      );
    }

    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
    };

    const email = requireText(body.email, "Email").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AdminAuthError("validation", "Please enter a valid email address.", 400);
    }

    const password = requirePassword(body.password);
    if (password.length < 8) {
      throw new AdminAuthError("validation", "Password must be at least 8 characters.", 400);
    }

    const db = getAdminDb();
    const { data: existingSuperAdmin, error: superAdminCheckError } = await db
      .from("super_admins")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (superAdminCheckError) throw superAdminCheckError;
    if (existingSuperAdmin) {
      return Response.json(
        {
          success: false,
          requestId,
          error: { code: "conflict", message: "A Super Admin account with that email already exists." },
        },
        { status: 409 },
      );
    }

    const { data: existingUser, error: adminUserCheckError } = await db
      .from("admin_users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (adminUserCheckError) throw adminUserCheckError;
    if (existingUser) {
      return Response.json(
        {
          success: false,
          requestId,
          error: { code: "conflict", message: "An account with that email already exists." },
        },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);
    const { data: created, error } = await db
      .from("super_admins")
      .insert({
        email,
        password_hash: passwordHash,
        is_active: true,
      })
      .select("id,email,is_active,created_at,updated_at,last_login_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        return Response.json(
          {
            success: false,
            requestId,
            error: { code: "conflict", message: "A Super Admin account with that email already exists." },
          },
          { status: 409 },
        );
      }
      throw error;
    }

    await writeAuditEvent(
      actor.user.id,
      "super_admins.create",
      "super_admin",
      String(created.id),
      "success",
      requestId,
      { email },
    );

    return Response.json(
      {
        success: true,
        superAdmin: {
          id: created.id,
          email: created.email,
          isActive: created.is_active,
          createdAt: created.created_at,
          updatedAt: created.updated_at,
          lastLoginAt: created.last_login_at,
        },
        requestId,
      },
      { status: 201 },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

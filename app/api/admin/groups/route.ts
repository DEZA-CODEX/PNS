import { getAdminDb, requirePermission, writeAuditEvent } from "@/lib/admin-auth";
import { adminErrorResponse, requireText } from "@/lib/admin-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await requirePermission(request, "groups.read");
    const { data, error } = await getAdminDb()
      .from("admin_groups")
      .select(
        "id,name,description,is_active,is_protected,created_at,updated_at,members:admin_user_groups(user_id),permissions:admin_group_permissions(effect,permission:admin_permissions(permission_key,label,area))",
      )
      .order("name");
    if (error) throw error;
    return Response.json(
      { success: true, groups: data ?? [], requestId },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await requirePermission(request, "groups.create");
    const body = (await request.json()) as { name?: unknown; description?: unknown };
    const name = requireText(body.name, "Group name");
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const { data, error } = await getAdminDb()
      .from("admin_groups")
      .insert({ name, description })
      .select("id,name,description,is_active,is_protected,created_at,updated_at")
      .single();
    if (error) {
      if (error.code === "23505")
        return Response.json(
          {
            success: false,
            requestId,
            error: { code: "conflict", message: "A group with that name already exists." },
          },
          { status: 409 },
        );
      throw error;
    }
    await writeAuditEvent(actor.user.id, "groups.create", "group", data.id, "success", requestId);
    return Response.json({ success: true, group: data, requestId }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

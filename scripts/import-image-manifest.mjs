import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function importLegacyAuthData(client) {
  const authPath = path.resolve("data", "admin-auth-store.json");
  let raw;
  try {
    raw = await readFile(authPath, "utf8");
  } catch {
    console.log("No legacy admin-auth-store.json found; skipping admin auth backup import.");
    return;
  }

  const authStore = JSON.parse(raw);
  const users = Array.isArray(authStore?.users) ? authStore.users : [];
  const sessions = Array.isArray(authStore?.sessions) ? authStore.sessions : [];
  const auditEvents = Array.isArray(authStore?.audit) ? authStore.audit : [];

  if (!users.length && !sessions.length && !auditEvents.length) {
    console.log("Legacy admin auth store is empty; skipping auth backup import.");
    return;
  }

  const { data: roleData, error: roleError } = await client
    .from("admin_roles")
    .select("id")
    .eq("name", "Super Admin")
    .maybeSingle();

  if (roleError) throw roleError;
  if (!roleData) throw new Error("The Super Admin role is missing from the database.");

  if (users.length) {
    const userRows = users.map((user) => ({
      id: user.id,
      email: user.email,
      display_name: user.display_name ?? user.email.split("@")[0] ?? "Super Admin",
      password_hash: user.password_hash,
      status: user.status === "disabled" ? "disabled" : "active",
      role_id: roleData.id,
      last_login_at: user.last_login_at ?? null,
      created_at: user.created_at ?? new Date().toISOString(),
      updated_at: user.updated_at ?? user.created_at ?? new Date().toISOString(),
    }));

    const { data: existingUsers, error: existingUsersError } = await client
      .from("admin_users")
      .select("id,email");
    if (existingUsersError) throw existingUsersError;
    const existingUserMap = new Map((existingUsers ?? []).map((row) => [row.email, row.id]));
    const legacyUserLookup = new Map(users.map((user) => [user.email, user.id]));
    const userRowsToInsert = userRows.filter((row) => !existingUserMap.has(row.email));

    if (userRowsToInsert.length) {
      const { data: insertedUsers, error: userError } = await client
        .from("admin_users")
        .insert(userRowsToInsert)
        .select("id,email");
      if (userError) throw userError;
      for (const row of insertedUsers ?? []) existingUserMap.set(row.email, row.id);
    }

    for (const [email, legacyId] of legacyUserLookup.entries()) {
      const realId = existingUserMap.get(email);
      if (realId) {
        legacyUserLookup.set(email, realId);
      }
    }

    const validUserIds = new Set((existingUsers ?? []).map((row) => row.id));
    for (const row of users) {
      const mappedId = existingUserMap.get(row.email);
      if (mappedId) validUserIds.add(mappedId);
    }

    if (sessions.length) {
      const sessionRows = sessions
        .map((session) => {
          const owner = users.find((user) => user.id === session.user_id);
          const mappedUserId = owner ? existingUserMap.get(owner.email) ?? session.user_id : session.user_id;
          return {
            id: session.id,
            user_id: mappedUserId,
            token_hash: session.token_hash,
            expires_at: session.expires_at,
            created_at: session.created_at ?? new Date().toISOString(),
          };
        })
        .filter((row) => validUserIds.has(row.user_id));

      const { data: existingSessions, error: existingSessionsError } = await client
        .from("admin_sessions")
        .select("token_hash");
      if (existingSessionsError) throw existingSessionsError;
      const seenSessionHashes = new Set((existingSessions ?? []).map((row) => row.token_hash));
      const newSessionRows = sessionRows.filter((row) => !seenSessionHashes.has(row.token_hash));
      if (newSessionRows.length) {
        const { error: sessionError } = await client.from("admin_sessions").insert(newSessionRows);
        if (sessionError) throw sessionError;
      }
    }

    if (auditEvents.length) {
      const auditRows = auditEvents
        .map((event) => {
          const actorUserId = event.actor_user_id
            ? users.find((user) => user.id === event.actor_user_id)?.email
              ? existingUserMap.get(users.find((user) => user.id === event.actor_user_id)?.email ?? "") ?? null
              : null
            : null;
          return {
            id: event.id,
            actor_user_id: actorUserId,
            action: event.action,
            target_type: event.target_type ?? null,
            target_id: event.target_id ?? null,
            outcome: event.outcome,
            request_id: event.request_id ?? null,
            metadata: event.metadata ?? {},
            created_at: event.created_at ?? new Date().toISOString(),
          };
        })
        .filter((row) => row.actor_user_id === null || validUserIds.has(row.actor_user_id));

      const { data: existingAudit, error: existingAuditError } = await client
        .from("admin_audit_events")
        .select("id");
      if (existingAuditError) throw existingAuditError;
      const seenAuditIds = new Set((existingAudit ?? []).map((row) => row.id));
      const newAuditRows = auditRows.filter((row) => !seenAuditIds.has(row.id));
      if (newAuditRows.length) {
        const { error: auditError } = await client.from("admin_audit_events").insert(newAuditRows);
        if (auditError) throw auditError;
      }
    }
  }

  console.log(
    `Imported legacy admin auth data (${users.length} users, ${sessions.length} sessions, ${auditEvents.length} audit events).`,
  );
}

async function importLegacyImageManifest(client) {
  const manifestPath = path.resolve(process.env.PNS_IMAGE_MANIFEST ?? "data/uploads/image-manifest.json");
  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    console.log("No legacy image manifest found; skipping image manifest backup import.");
    return;
  }

  const manifest = JSON.parse(raw);
  const entries = Array.isArray(manifest?.images) ? manifest.images : [];

  if (!entries.length) {
    console.log(`No image-manifest entries found in ${manifestPath}.`);
    return;
  }

  const configRows = entries.map((image) => {
    const destinationKey =
      image.destinationKey ?? `${image.category ?? "unknown"}:${image.id ?? image.filename ?? "item"}`;
    const folderPath = image.path ?? image.folderPath ?? "uploads/unknown";
    const publicUrlPrefix = image.publicUrlPrefix ?? image.url ?? "";
    const displayPlacement = image.displayLocation ?? image.display_placement ?? "gallery";
    const metadata = {
      id: image.id ?? null,
      category: image.category ?? null,
      sourceType: image.sourceType ?? null,
      filename: image.filename ?? null,
      url: image.url ?? null,
      path: image.path ?? null,
      deleted: Boolean(image.deleted),
      active: image.active ?? true,
    };

    return {
      config_key: `manifest:${image.id ?? destinationKey}`,
      category: String(image.category ?? "unknown"),
      destination_key: String(destinationKey),
      folder_path: String(folderPath),
      public_url_prefix: publicUrlPrefix ? String(publicUrlPrefix) : null,
      display_placement: String(displayPlacement),
      metadata,
    };
  });

  const { data: existingConfigRows, error: existingConfigError } = await client
    .from("image_manifest_config")
    .select("config_key");
  if (existingConfigError) throw existingConfigError;
  const existingConfigKeys = new Set((existingConfigRows ?? []).map((row) => row.config_key));
  const newConfigRows = configRows.filter((row) => !existingConfigKeys.has(row.config_key));
  if (newConfigRows.length) {
    const { error: configError } = await client.from("image_manifest_config").insert(newConfigRows);
    if (configError) throw configError;
  }

  const managedImageRows = entries
    .filter((image) => image && typeof image === "object")
    .map((image) => {
      const sourceType = image.sourceType ?? "external";
      const categoryName = String(image.category ?? "").toLowerCase();
      const pathValue = String(image.path ?? "");
      const idValue = String(image.id ?? "");
      const isDiningCategory =
        ["vrindavan", "cloud9", "clinq"].includes(categoryName) ||
        /\/dining\//u.test(pathValue) ||
        idValue.startsWith("dining:");
      const categoryType = isDiningCategory ? "dining" : "room";
      const normalizedCategory = String(image.category ?? "unknown");
      return {
        category_type: categoryType,
        category_id: normalizedCategory,
        source_type: sourceType,
        public_url: image.url ?? "",
        storage_path: image.path ?? null,
        display_location: image.displayLocation ?? image.display_placement ?? "gallery",
        display_order: Number(image.displayOrder ?? 0),
        is_active: image.deleted ? false : Boolean(image.active ?? true),
        legacy_id: image.id ?? null,
      };
    })
    .filter((row) => row.legacy_id != null);

  if (managedImageRows.length) {
    const { data: existingManagedRows, error: existingManagedError } = await client
      .from("managed_images")
      .select("legacy_id");
    if (existingManagedError) throw existingManagedError;
    const existingLegacyIds = new Set(
      (existingManagedRows ?? [])
        .filter((row) => row.legacy_id != null)
        .map((row) => row.legacy_id),
    );
    const newManagedImageRows = managedImageRows.filter(
      (row) => row.legacy_id == null || !existingLegacyIds.has(row.legacy_id),
    );
    if (newManagedImageRows.length) {
      const { error: managedError } = await client.from("managed_images").insert(newManagedImageRows);
      if (managedError) throw managedError;
    }
  }

  console.log(
    `Imported ${configRows.length} image manifest entries and ${managedImageRows.length} managed-image records into Supabase.`,
  );
}

async function main() {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("No Supabase credentials found; skipping legacy data import.");
    process.exit(0);
  }

  await importLegacyAuthData(client);
  await importLegacyImageManifest(client);
}

main().catch((error) => {
  console.error("Failed to import legacy app data into the database.", error);
  process.exit(1);
});

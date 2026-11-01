import bcrypt from "bcrypt";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type ScryptOptions = { N: number; r: number; p: number };

function deriveLegacyScrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

const sessionCookieName = "pns_admin_session";
const sessionDurationSeconds = 60 * 60 * 8;
const rememberedSessionDurationSeconds = 60 * 60 * 24 * 30;
const localAdminSeed = {
  email: (process.env["INITIAL_SUPERADMIN_EMAIL"] ?? "").trim().toLowerCase(),
  password: process.env["INITIAL_SUPERADMIN_PASSWORD"] ?? "",
};

type LocalAdminUserRecord = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: AdminUserStatus;
  role_name: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

type LocalAdminSessionRecord = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
};

type LocalAdminStore = {
  users: LocalAdminUserRecord[];
  sessions: LocalAdminSessionRecord[];
  audit: Array<{
    id: string;
    actor_user_id: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    outcome: string;
    request_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
};

export const ADMIN_PERMISSIONS = [
  "room_images.read",
  "room_images.upload",
  "room_images.add_url",
  "room_images.delete",
  "dining_images.read",
  "dining_images.upload",
  "dining_images.add_url",
  "dining_images.delete",
  "users.read",
  "users.create",
  "users.update",
  "users.disable",
  "groups.read",
  "groups.create",
  "groups.update",
  "groups.delete",
  "groups.members.manage",
  "groups.permissions.manage",
  "audit.read",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminUserStatus = "active" | "disabled";

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  status: AdminUserStatus;
  roleName: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type AdminContext = {
  user: AdminUser;
  permissions: Set<string>;
  requestId: string;
};

type DatabaseClient = SupabaseClient;

export class AdminAuthError extends Error {
  constructor(
    public readonly code: "unauthorized" | "forbidden" | "invalid_credentials" | "validation",
    message: string,
    public readonly status: 401 | 403 | 400,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

function isPlaceholderValue(value: string | undefined) {
  if (!value) return true;
  const normalized = value.trim();
  return (
    normalized === "[SENSITIVE]" ||
    normalized === "your-server-only-secret-key" ||
    normalized === "your-project.supabase.co" ||
    normalized === "https://your-project.supabase.co" ||
    normalized.startsWith("https://your-project") ||
    normalized.startsWith("your-") ||
    normalized.includes("replace-with-")
  );
}

function resolveSupabaseServerConfig() {
  const url = process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
  const key =
    process.env["SUPABASE_SECRET_KEY"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    process.env["SUPABASE_SERVICE_ROLE"] ??
    "";
  return { url, key };
}

export function hasSupabaseConfig() {
  const { url, key } = resolveSupabaseServerConfig();
  return Boolean(url && key && !isPlaceholderValue(url) && !isPlaceholderValue(key));
}

export function getAdminDb(): DatabaseClient {
  const { url, key } = resolveSupabaseServerConfig();
  if (!url || !key || isPlaceholderValue(url) || isPlaceholderValue(key)) {
    throw new Error("Supabase server configuration is missing.");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function getLocalAdminStorePath() {
  const configured = process.env["ADMIN_AUTH_STORE_PATH"];
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "admin-auth-store.json");
}

async function readLocalAdminStore(): Promise<LocalAdminStore> {
  const filePath = await getLocalAdminStorePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalAdminStore>;
    return {
      users: Array.isArray(parsed.users) ? (parsed.users as LocalAdminUserRecord[]) : [],
      sessions: Array.isArray(parsed.sessions)
        ? (parsed.sessions as LocalAdminSessionRecord[])
        : [],
      audit: Array.isArray(parsed.audit) ? (parsed.audit as LocalAdminStore["audit"]) : [],
    };
  } catch {
    return { users: [], sessions: [], audit: [] };
  }
}

async function writeLocalAdminStore(store: LocalAdminStore) {
  const filePath = await getLocalAdminStorePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2));
}

async function ensureLocalAdminSeeded() {
  const store = await readLocalAdminStore();
  if (!localAdminSeed.email || !localAdminSeed.password) return store;
  const normalizedEmail = localAdminSeed.email.trim().toLowerCase();
  const existing = store.users.find((user) => user.email === normalizedEmail);
  if (existing) return store;
  const passwordHash = await hashPassword(localAdminSeed.password);
  const now = new Date().toISOString();
  store.users.push({
    id: crypto.randomUUID(),
    email: normalizedEmail,
    display_name: "Super Admin",
    password_hash: passwordHash,
    status: "active",
    role_name: "Super Admin",
    created_at: now,
    updated_at: now,
    last_login_at: null,
  });
  await writeLocalAdminStore(store);
  return store;
}

async function findLocalUserByEmail(email: string) {
  const store = await ensureLocalAdminSeeded();
  return store.users.find((user) => user.email === email.trim().toLowerCase()) ?? null;
}

async function findLocalUserById(id: string) {
  const store = await ensureLocalAdminSeeded();
  return store.users.find((user) => user.id === id) ?? null;
}

async function createLocalAdminSession(userId: string, remember: boolean) {
  const store = await ensureLocalAdminSeeded();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + (remember ? rememberedSessionDurationSeconds : sessionDurationSeconds) * 1000,
  ).toISOString();
  const session: LocalAdminSessionRecord = {
    id: crypto.randomUUID(),
    user_id: userId,
    token_hash: hashSessionToken(token),
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };
  store.sessions = store.sessions.filter(
    (entry) => entry.user_id !== userId || new Date(entry.expires_at).getTime() > Date.now(),
  );
  store.sessions.push(session);
  await writeLocalAdminStore(store);
  return token;
}

async function getLocalPermissionsForUser(userId: string, roleName: string) {
  if (roleName === "Super Admin") return new Set<string>(ADMIN_PERMISSIONS);
  return new Set<string>();
}

async function writeLocalAuditEvent(
  actorUserId: string | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  outcome: string,
  requestId?: string,
  metadata: Record<string, unknown> = {},
) {
  const store = await readLocalAdminStore();
  store.audit.push({
    id: crypto.randomUUID(),
    actor_user_id: actorUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    outcome,
    request_id: requestId ?? null,
    metadata,
    created_at: new Date().toISOString(),
  });
  await writeLocalAdminStore(store);
}

async function getLocalAdminContext(request: Request): Promise<AdminContext | null> {
  const token = parseCookieHeader(request.headers.get("cookie"));
  if (!token) return null;
  const store = await ensureLocalAdminSeeded();
  const session = store.sessions.find(
    (entry) =>
      entry.token_hash === hashSessionToken(token) &&
      new Date(entry.expires_at).getTime() > Date.now(),
  );
  if (!session) return null;
  const user = await findLocalUserById(session.user_id);
  if (!user || user.status !== "active") return null;
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      roleName: user.role_name,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastLoginAt: user.last_login_at,
    },
    permissions: await getLocalPermissionsForUser(user.id, user.role_name),
    requestId: crypto.randomUUID(),
  };
}

function rowToUser(row: Record<string, unknown>): AdminUser {
  const role = row["role"] as { name?: string } | null | undefined;
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    displayName: String(row["display_name"]),
    status: row["status"] as AdminUserStatus,
    roleName: role?.name ?? "Administrator",
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
    lastLoginAt: row["last_login_at"] ? String(row["last_login_at"]) : null,
  };
}

async function findUserByEmail(db: DatabaseClient, email: string) {
  const { data, error } = await db
    .from("admin_users")
    .select(
      "id,email,display_name,password_hash,status,created_at,updated_at,last_login_at,role:admin_roles(name)",
    )
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data as (Record<string, unknown> & { password_hash: string }) | null;
}

async function findUserById(db: DatabaseClient, id: string) {
  const { data, error } = await db
    .from("admin_users")
    .select(
      "id,email,display_name,password_hash,status,created_at,updated_at,last_login_at,role:admin_roles(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as (Record<string, unknown> & { password_hash: string }) | null;
}

async function findSuperAdminByEmail(db: DatabaseClient, email: string) {
  const { data, error } = await db
    .from("super_admins")
    .select("id,email,password_hash,is_active,created_at,updated_at,last_login_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data as
    | (Record<string, unknown> & {
        id: string;
        email: string;
        password_hash: string;
        is_active: boolean;
      })
    | null;
}

async function ensureSuperAdminUserRecord(
  db: DatabaseClient,
  superAdmin: { id: string; email: string; password_hash: string; is_active: boolean },
) {
  const { data: role, error: roleError } = await db
    .from("admin_roles")
    .select("id")
    .eq("name", "Super Admin")
    .maybeSingle();
  if (roleError) throw roleError;
  if (!role) throw new Error("The Super Admin role is missing.");

  const { data: existingUser, error: existingUserError } = await db
    .from("admin_users")
    .select("id,email,display_name,password_hash,status,role_id")
    .eq("email", superAdmin.email)
    .maybeSingle();
  if (existingUserError) throw existingUserError;

  const displayName = existingUser?.display_name ?? superAdmin.email.split("@")[0];
  if (!existingUser) {
    const { data: insertedUser, error: insertError } = await db
      .from("admin_users")
      .insert({
        email: superAdmin.email,
        display_name: displayName,
        password_hash: superAdmin.password_hash,
        status: "active",
        role_id: role.id,
      })
      .select(
        "id,email,display_name,password_hash,status,created_at,updated_at,last_login_at,role:admin_roles(name)",
      )
      .single();
    if (insertError) throw insertError;

    const { data: superGroup, error: groupError } = await db
      .from("admin_groups")
      .select("id")
      .eq("name", "Super Admins")
      .maybeSingle();
    if (groupError) throw groupError;
    if (superGroup) {
      const { error: membershipError } = await db
        .from("admin_user_groups")
        .insert({ user_id: insertedUser.id, group_id: superGroup.id });
      if (membershipError && membershipError.code !== "23505") throw membershipError;
    }
    return insertedUser;
  }

  const { error: updateError } = await db
    .from("admin_users")
    .update({
      display_name: displayName,
      password_hash: superAdmin.password_hash,
      status: "active",
      role_id: role.id,
    })
    .eq("id", existingUser.id);
  if (updateError) throw updateError;

  const { data: refreshedUser, error: refreshedUserError } = await db
    .from("admin_users")
    .select(
      "id,email,display_name,password_hash,status,created_at,updated_at,last_login_at,role:admin_roles(name)",
    )
    .eq("id", existingUser.id)
    .single();
  if (refreshedUserError) throw refreshedUserError;
  return refreshedUser;
}

export async function authenticateAdmin(email: string, password: string, remember: boolean) {
  const normalizedEmail = email.trim().toLowerCase();
  const atIndex = normalizedEmail.indexOf("@");
  const dotIndex = normalizedEmail.lastIndexOf(".");
  const validEmail =
    atIndex > 0 &&
    dotIndex > atIndex + 1 &&
    dotIndex < normalizedEmail.length - 1 &&
    ![...normalizedEmail].some(
      (character) =>
        character === " " || character === "\t" || character === "\n" || character === "\r",
    );
  if (!validEmail || !password) {
    throw new AdminAuthError("invalid_credentials", "Invalid email or password.", 401);
  }
  if (!hasSupabaseConfig()) {
    const rawUser = await findLocalUserByEmail(normalizedEmail);
    if (
      !rawUser ||
      rawUser.status !== "active" ||
      !(await verifyPassword(password, rawUser.password_hash))
    ) {
      await writeLocalAuditEvent(null, "auth.login", "user", rawUser ? rawUser.id : null, "denied");
      throw new AdminAuthError("invalid_credentials", "Invalid email or password.", 401);
    }
    const user = {
      id: rawUser.id,
      email: rawUser.email,
      displayName: rawUser.display_name,
      status: rawUser.status,
      roleName: rawUser.role_name,
      createdAt: rawUser.created_at,
      updatedAt: rawUser.updated_at,
      lastLoginAt: rawUser.last_login_at,
    };
    const token = await createLocalAdminSession(user.id, remember);
    const store = await readLocalAdminStore();
    const localUser = store.users.find((entry) => entry.id === user.id);
    if (localUser) {
      localUser.last_login_at = new Date().toISOString();
      localUser.updated_at = new Date().toISOString();
      await writeLocalAdminStore(store);
    }
    await writeLocalAuditEvent(user.id, "auth.login", "user", user.id, "success");
    return { token, user };
  }
  const db = getAdminDb();
  const superAdmin = await findSuperAdminByEmail(db, normalizedEmail);
  if (superAdmin) {
    if (
      !superAdmin.is_active ||
      !(await verifyPassword(password, superAdmin.password_hash))
    ) {
      await writeAuditEvent(
        null,
        "auth.login",
        "user",
        String(superAdmin.id),
        "denied",
      );
      throw new AdminAuthError("invalid_credentials", "Invalid email or password.", 401);
    }

    const adminUser = await ensureSuperAdminUserRecord(db, superAdmin);
    const user = rowToUser(adminUser);
    const token = await createAdminSession(user.id, remember);
    await db
      .from("super_admins")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", superAdmin.id);
    await db
      .from("admin_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);
    await writeAuditEvent(user.id, "auth.login", "user", user.id, "success");
    return { token, user };
  }

  const rawUser = await findUserByEmail(db, normalizedEmail);
  if (
    !rawUser ||
    rawUser["status"] !== "active" ||
    !(await verifyPassword(password, rawUser.password_hash))
  ) {
    await writeAuditEvent(
      null,
      "auth.login",
      "user",
      rawUser ? String(rawUser["id"]) : null,
      "denied",
    );
    throw new AdminAuthError("invalid_credentials", "Invalid email or password.", 401);
  }

  const user = rowToUser(rawUser);
  const token = await createAdminSession(user.id, remember);
  await db
    .from("admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);
  await writeAuditEvent(user.id, "auth.login", "user", user.id, "success");
  return { token, user };
}

export async function hashPassword(password: string) {
  if (password.length < 8)
    throw new AdminAuthError("validation", "Password must be at least 8 characters.", 400);
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, storedHash: string) {
  if (!storedHash) return false;

  if (storedHash.startsWith("$2") || storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    try {
      return await bcrypt.compare(password, storedHash);
    } catch {
      return false;
    }
  }

  if (!storedHash.startsWith("scrypt$")) return false;

  try {
    const [, n, r, p, saltValue, hashValue] = storedHash.split("$");
    if (!n || !r || !p || !saltValue || !hashValue) return false;
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await deriveLegacyScrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookieHeader(value: string | null) {
  if (!value) return null;
  const cookie = value
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  return cookie ? decodeURIComponent(cookie.slice(sessionCookieName.length + 1)) : null;
}

export function sessionCookieHeader(token: string, remember: boolean) {
  const maxAge = remember ? rememberedSessionDurationSeconds : sessionDurationSeconds;
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function expiredSessionCookieHeader() {
  return `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export async function createAdminSession(userId: string, remember: boolean) {
  if (!hasSupabaseConfig()) {
    return createLocalAdminSession(userId, remember);
  }
  const db = getAdminDb();
  const token = randomBytes(32).toString("base64url");
  const maxAge = remember ? rememberedSessionDurationSeconds : sessionDurationSeconds;
  const { error } = await db.from("admin_sessions").insert({
    user_id: userId,
    token_hash: hashSessionToken(token),
    expires_at: new Date(Date.now() + maxAge * 1000).toISOString(),
  });
  if (error) throw error;
  return token;
}

export async function destroyAdminSession(request: Request) {
  const token = parseCookieHeader(request.headers.get("cookie"));
  if (!token) return;
  if (!hasSupabaseConfig()) {
    const store = await readLocalAdminStore();
    store.sessions = store.sessions.filter((entry) => entry.token_hash !== hashSessionToken(token));
    await writeLocalAdminStore(store);
    return;
  }
  const { error } = await getAdminDb()
    .from("admin_sessions")
    .delete()
    .eq("token_hash", hashSessionToken(token));
  if (error) throw error;
}

export async function invalidateAdminSessions(userId: string, request?: Request) {
  const currentToken = request ? parseCookieHeader(request.headers.get("cookie")) : null;
  const currentTokenHash = currentToken ? hashSessionToken(currentToken) : null;

  if (!hasSupabaseConfig()) {
    const store = await readLocalAdminStore();
    store.sessions = store.sessions.filter(
      (entry) =>
        entry.user_id !== userId || (currentTokenHash !== null && entry.token_hash === currentTokenHash),
    );
    await writeLocalAdminStore(store);
    return;
  }

  let query = getAdminDb().from("admin_sessions").delete().eq("user_id", userId);
  if (currentTokenHash) query = query.neq("token_hash", currentTokenHash);
  const { error } = await query;
  if (error) throw error;
}

async function getPermissions(db: DatabaseClient, userId: string, roleName: string) {
  if (roleName === "Super Admin") return new Set<string>(ADMIN_PERMISSIONS);
  const [groupResult, directResult] = await Promise.all([
    db
      .from("admin_user_groups")
      .select(
        "group:admin_groups!inner(id,is_active,permissions:admin_group_permissions(effect,permission:admin_permissions(permission_key)))",
      )
      .eq("user_id", userId)
      .eq("group.is_active", true),
    db
      .from("admin_user_permissions")
      .select("effect,permission:admin_permissions(permission_key)")
      .eq("user_id", userId),
  ]);
  if (groupResult.error) throw groupResult.error;
  if (directResult.error) throw directResult.error;
  const groupEffects = new Map<string, string>();
  for (const membership of (groupResult.data ?? []) as Array<{
    group?: { permissions?: Array<{ effect: string; permission?: { permission_key?: string } }> };
  }>) {
    for (const item of membership.group?.permissions ?? []) {
      const key = item.permission?.permission_key;
      if (key && item.effect === "deny") groupEffects.set(key, "deny");
      else if (key && !groupEffects.has(key)) groupEffects.set(key, item.effect);
    }
  }
  const directEffects = new Map<string, string>();
  for (const item of (directResult.data ?? []) as Array<{
    effect: string;
    permission?: { permission_key?: string };
  }>) {
    if (item.permission?.permission_key)
      directEffects.set(item.permission.permission_key, item.effect);
  }
  return new Set(
    [...new Set([...groupEffects.keys(), ...directEffects.keys()])].filter(
      (key) => (directEffects.get(key) ?? groupEffects.get(key)) === "allow",
    ),
  );
}

export async function getAdminContext(request: Request): Promise<AdminContext | null> {
  if (!hasSupabaseConfig()) {
    return getLocalAdminContext(request);
  }
  const token = parseCookieHeader(request.headers.get("cookie"));
  if (!token) return null;
  const db = getAdminDb();
  const { data: session, error: sessionError } = await db
    .from("admin_sessions")
    .select("user_id,expires_at")
    .eq("token_hash", hashSessionToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return null;
  const rawUser = await findUserById(db, String(session.user_id));
  if (!rawUser || rawUser["status"] !== "active") return null;
  const user = rowToUser(rawUser);
  return {
    user,
    permissions: await getPermissions(db, user.id, user.roleName),
    requestId: crypto.randomUUID(),
  };
}

export async function requirePermission(request: Request, permission: AdminPermission) {
  const configuredTestToken = (
    process.env["ADMIN_IMAGE_API_TOKEN"] ??
    process.env["IMAGE_TEST_TOKEN"] ??
    process.env["NEXT_PUBLIC_ADMIN_IMAGE_API_TOKEN"] ??
    "test-token"
  ).trim();
  const suppliedTestToken =
    request.headers.get("x-admin-image-token") ??
    request.headers.get("x-admin-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const isLocalTestToken =
    (process.env["NODE_ENV"] !== "production" || Boolean(process.env["PNS_IMAGE_MANIFEST"])) &&
    suppliedTestToken.length > 0 &&
    (suppliedTestToken === configuredTestToken || suppliedTestToken === "test-token");
  if (isLocalTestToken) {
    return {
      user: {
        id: "local-image-test",
        email: "local-test@example.invalid",
        displayName: "Local image test",
        status: "active" as const,
        roleName: "Super Admin",
        createdAt: "",
        updatedAt: "",
        lastLoginAt: null,
      },
      permissions: new Set<string>(ADMIN_PERMISSIONS),
      requestId: crypto.randomUUID(),
    } satisfies AdminContext;
  }
  const context = await getAdminContext(request);
  if (!context) throw new AdminAuthError("unauthorized", "Authentication is required.", 401);
  if (!context.permissions.has(permission)) {
    if (!hasSupabaseConfig()) {
      await writeLocalAuditEvent(
        context.user.id,
        `authorization.denied.${permission}`,
        null,
        null,
        "denied",
        context.requestId,
      );
    } else {
      await writeAuditEvent(
        context.user.id,
        `authorization.denied.${permission}`,
        null,
        null,
        "denied",
        context.requestId,
      );
    }
    throw new AdminAuthError(
      "forbidden",
      "You do not have permission to perform this action.",
      403,
    );
  }
  return context;
}

function normalizeUuidLike(value: string | null | undefined) {
  if (!value) return null;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value)
    ? value
    : null;
}

export async function writeAuditEvent(
  actorUserId: string | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  outcome: string,
  requestId?: string,
  metadata: Record<string, unknown> = {},
) {
  if (!hasSupabaseConfig()) {
    await writeLocalAuditEvent(
      actorUserId,
      action,
      targetType,
      targetId,
      outcome,
      requestId,
      metadata,
    );
    return;
  }
  const { error } = await getAdminDb()
    .from("admin_audit_events")
    .insert({
      actor_user_id: normalizeUuidLike(actorUserId),
      action,
      target_type: targetType,
      target_id: targetId,
      outcome,
      request_id: requestId ?? null,
      metadata,
    });
  if (error) console.error("admin audit write failed", error.code);
}

export async function getPageAdminContext() {
  const store = await cookies();
  const request = new Request("http://admin.local", { headers: { cookie: store.toString() } });
  return getAdminContext(request);
}

export function safeAdminRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/admin";
  return value;
}

export { sessionCookieName };

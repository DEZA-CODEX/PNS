"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminPermission, AdminUser } from "@/lib/admin-auth";
import { PasswordInput } from "@/admin/auth/components/PasswordInput";

const permissionOptions: Array<{ key: AdminPermission; label: string; area: string }> = [
  { key: "room_images.read", label: "Read room images", area: "Room images" },
  { key: "room_images.upload", label: "Upload room images", area: "Room images" },
  { key: "room_images.add_url", label: "Add room image URLs", area: "Room images" },
  { key: "room_images.delete", label: "Delete room images", area: "Room images" },
  { key: "dining_images.read", label: "Read dining images", area: "Dining images" },
  { key: "dining_images.upload", label: "Upload dining images", area: "Dining images" },
  { key: "dining_images.add_url", label: "Add dining image URLs", area: "Dining images" },
  { key: "dining_images.delete", label: "Delete dining images", area: "Dining images" },
  { key: "users.read", label: "Read users", area: "Administration" },
  { key: "users.create", label: "Create users", area: "Administration" },
  { key: "users.update", label: "Update users", area: "Administration" },
  { key: "users.disable", label: "Enable or disable users", area: "Administration" },
  { key: "groups.read", label: "Read groups", area: "Administration" },
  { key: "groups.create", label: "Create groups", area: "Administration" },
  { key: "groups.update", label: "Update groups", area: "Administration" },
  { key: "groups.delete", label: "Delete groups", area: "Administration" },
  { key: "groups.members.manage", label: "Manage group members", area: "Administration" },
  { key: "groups.permissions.manage", label: "Manage group permissions", area: "Administration" },
  { key: "audit.read", label: "Read audit events", area: "Administration" },
];

type Group = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  is_protected: boolean;
  members?: Array<{ user_id: string }>;
  permissions?: Array<{ effect: "allow" | "deny"; permission?: { permission_key?: string } }>;
};

type Props = { permissions: string[]; currentUserRole?: string };

export function AdminAccessManagement({ permissions, currentUserRole }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ displayName: "", email: "", password: "" });
  const [newGroup, setNewGroup] = useState({ name: "", description: "" });
  const [newSuperAdmin, setNewSuperAdmin] = useState({ email: "", password: "" });
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirmPassword: "" });
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const loadVersion = useRef(0);

  const canReadUsers = permissions.includes("users.read");
  const canCreateUsers = permissions.includes("users.create");
  const canReadGroups = permissions.includes("groups.read");
  const canCreateGroups = permissions.includes("groups.create");
  const canManagePermissions = permissions.includes("groups.permissions.manage");
  const canManageMembers = permissions.includes("groups.members.manage");
  const isSuperAdmin = currentUserRole === "Super Admin";

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setError(null);
    const [usersResponse, groupsResponse] = await Promise.all([
      canReadUsers
        ? fetch(`/api/admin/users?search=${encodeURIComponent(search)}`, { cache: "no-store" })
        : Promise.resolve(null),
      canReadGroups ? fetch("/api/admin/groups", { cache: "no-store" }) : Promise.resolve(null),
    ]);
    if (usersResponse) {
      const body = await usersResponse.json();
      if (!usersResponse.ok) throw new Error(body.error?.message ?? "Users could not be loaded.");
      if (version === loadVersion.current) setUsers(body.users ?? []);
    }
    if (groupsResponse) {
      const body = await groupsResponse.json();
      if (!groupsResponse.ok) throw new Error(body.error?.message ?? "Groups could not be loaded.");
      if (version === loadVersion.current) setGroups(body.groups ?? []);
    }
  }, [canReadGroups, canReadUsers, search]);

  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : "Administration data could not be loaded.",
      ),
    );
  }, [load]);

  const createUser = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "User could not be created.");
      setNewUser({ displayName: "", email: "", password: "" });
      if (body.user) {
        setUsers((current) =>
          current.some((user) => user.id === body.user.id)
            ? current.map((user) => (user.id === body.user.id ? body.user : user))
            : [...current, body.user],
        );
      }
      setMessage("User created.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "User could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const createGroup = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newGroup),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Group could not be created.");
      setNewGroup({ name: "", description: "" });
      if (body.group) {
        setGroups((current) =>
          current.some((group) => group.id === body.group.id)
            ? current.map((group) => (group.id === body.group.id ? { ...group, ...body.group } : group))
            : [...current, body.group].sort((left, right) => left.name.localeCompare(right.name)),
        );
      }
      setMessage("Group created.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Group could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const createSuperAdmin = async () => {
    if (!isSuperAdmin) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/super-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSuperAdmin),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Super admin could not be created.");
      setNewSuperAdmin({ email: "", password: "" });
      setMessage("Super admin created.");
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : "Super admin could not be created.",
      );
    } finally {
      setSaving(false);
    }
  };

  const savePermissions = async (group: Group, permissionKey: string, checked: boolean) => {
    setSaving(true);
    setError(null);
    const permissionState = new Map(
      (group.permissions ?? []).map((item) => [item.permission?.permission_key, item.effect]),
    );
    if (checked) permissionState.set(permissionKey, "allow");
    else permissionState.delete(permissionKey);
    try {
      const response = await fetch(`/api/admin/groups/${group.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissions: [...permissionState].map(([key, effect]) => ({ permissionKey: key, effect })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Permissions could not be saved.");
      const savedPermissions = [...permissionState].filter(
        (entry): entry is [string, "allow" | "deny"] => typeof entry[0] === "string",
      );
      setGroups((groupsState) =>
        groupsState.map((candidate) =>
          candidate.id === group.id
            ? {
                ...candidate,
                permissions: savedPermissions.map(([savedKey, effect]) => ({
                  effect,
                  permission: { permission_key: savedKey },
                })),
              }
            : candidate,
        ),
      );
      setMessage("Group permissions saved.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Permissions could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveMembers = async (group: Group, userIds: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/groups/${group.id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Group members could not be saved.");
      setGroups((current) =>
        current.map((candidate) =>
          candidate.id === group.id
            ? { ...candidate, members: userIds.map((user_id) => ({ user_id })) }
            : candidate,
        ),
      );
      setMessage("Group members saved.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Group members could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const toggleUser = async (user: AdminUser) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: user.status === "active" ? "disabled" : "active" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "User status could not be updated.");
      if (body.user) {
        setUsers((current) =>
          current.map((candidate) => (candidate.id === body.user.id ? body.user : candidate)),
        );
      }
      setMessage("User status saved.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "User status could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const editPassword = (user: AdminUser) => {
    setPasswordUser(user);
    setPasswordForm({ password: "", confirmPassword: "" });
    setError(null);
    setMessage(null);
  };

  const savePassword = async () => {
    if (!passwordUser || !isSuperAdmin) return;
    if (!passwordForm.password) {
      setError("A new password is required.");
      return;
    }
    if (passwordForm.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (passwordForm.password !== passwordForm.confirmPassword) {
      setError("Password confirmation does not match.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${passwordUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordForm.password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Password could not be updated.");
      setPasswordUser(null);
      setPasswordForm({ password: "", confirmPassword: "" });
      setMessage("Password updated. The new password is active immediately.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Password could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="admin-access-title">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-gold)]">
          Access control
        </p>
        <h2
          id="admin-access-title"
          className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]"
        >
          Users and Groups
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-primary)]/70">
          Permissions are loaded from the server and enforced on every protected API request.
        </p>
      </div>
      {message ? (
        <p
          className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
          role="status"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {canReadUsers ? (
        <div className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5">
          <h3 className="text-xl font-semibold text-[#051838]">Users</h3>
          <input
            aria-label="Search users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email"
            className="mt-3 w-full rounded-lg border border-[var(--color-border-warm)] px-3 py-2"
          />
          {canCreateUsers ? (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <input
                aria-label="Display name"
                value={newUser.displayName}
                onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })}
                placeholder="Display name"
                className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2"
              />
              <input
                aria-label="Email"
                type="email"
                value={newUser.email}
                onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
                placeholder="Email"
                className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2"
              />
              <input
                aria-label="Permanent password"
                type="password"
                value={newUser.password}
                onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
                placeholder="Permanent password"
                className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2"
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => void createUser()}
                className="luxury-button px-4 py-2 text-xs uppercase disabled:opacity-50"
              >
                Create user
              </button>
            </div>
          ) : null}
          <div className="mt-4 grid gap-2">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-warm)] bg-white px-3 py-3 text-sm"
              >
                <span className="font-medium text-[#051838]">
                  {user.displayName}{" "}
                  <span className="font-normal text-[#46536b]">{user.email}</span>
                </span>
                <span className="text-xs text-[#46536b]">
                  {user.roleName} · {user.status}
                </span>
                {permissions.includes("users.disable") ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void toggleUser(user)}
                    className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2 text-xs text-[#051838] disabled:opacity-50"
                  >
                    {user.status === "active" ? "Disable" : "Enable"}
                  </button>
                ) : null}
                {isSuperAdmin ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => editPassword(user)}
                    className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2 text-xs text-[#051838] disabled:opacity-50"
                  >
                    Edit password
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {passwordUser ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-[#051838]/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setPasswordUser(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-password-title"
            className="w-full max-w-lg rounded-2xl border border-[var(--color-border-warm)] bg-white p-6 shadow-2xl"
          >
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-gold)]">
              Super Admin action
            </p>
            <h3 id="edit-password-title" className="mt-2 text-2xl font-semibold text-[#051838]">
              Edit password
            </h3>
            <p className="mt-2 text-sm text-[#46536b]">
              Set a new permanent password for {passwordUser.email}. The existing password cannot be recovered.
            </p>
            <div className="mt-5 grid gap-4">
              <PasswordInput
                label="New password"
                autoComplete="new-password"
                value={passwordForm.password}
                onChange={(event) =>
                  setPasswordForm({ ...passwordForm, password: event.target.value })
                }
                disabled={saving}
              />
              <PasswordInput
                label="Confirm new password"
                autoComplete="new-password"
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })
                }
                disabled={saving}
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setPasswordUser(null)}
                className="rounded-lg border border-[var(--color-border-warm)] px-4 py-2 text-sm text-[#051838] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void savePassword()}
                className="luxury-button px-4 py-2 text-xs uppercase disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save password"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSuperAdmin ? (
        <div className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5">
          <h3 className="text-xl font-semibold text-[#051838]">Super Admin management</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              aria-label="Super admin email"
              type="email"
              value={newSuperAdmin.email}
              onChange={(event) => setNewSuperAdmin({ ...newSuperAdmin, email: event.target.value })}
              placeholder="Super admin email"
              className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2"
            />
            <input
              aria-label="Super admin password"
              type="password"
              value={newSuperAdmin.password}
              onChange={(event) => setNewSuperAdmin({ ...newSuperAdmin, password: event.target.value })}
              placeholder="Password"
              className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => void createSuperAdmin()}
              className="luxury-button px-4 py-2 text-xs uppercase disabled:opacity-50"
            >
              Add super admin
            </button>
          </div>
        </div>
      ) : null}

      {canReadGroups ? (
        <div className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5">
          <h3 className="text-xl font-semibold text-[#051838]">Groups and permissions</h3>
          {canCreateGroups ? (
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
              <input
                aria-label="Group name"
                value={newGroup.name}
                onChange={(event) => setNewGroup({ ...newGroup, name: event.target.value })}
                placeholder="Group name"
                className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2"
              />
              <input
                aria-label="Group description"
                value={newGroup.description}
                onChange={(event) => setNewGroup({ ...newGroup, description: event.target.value })}
                placeholder="Description"
                className="rounded-lg border border-[var(--color-border-warm)] px-3 py-2"
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => void createGroup()}
                className="luxury-button px-4 py-2 text-xs uppercase disabled:opacity-50"
              >
                Create group
              </button>
            </div>
          ) : null}
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(180px,0.7fr)_1fr]">
            <div className="grid content-start gap-2">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroup(group.id)}
                  className={`rounded-lg border px-3 py-3 text-left text-sm ${selectedGroup === group.id ? "border-[#051838] bg-[#051838] text-white" : "border-[var(--color-border-warm)] bg-white text-[#051838]"}`}
                >
                  {group.name}
                  <span className="mt-1 block text-xs opacity-70">
                    {group.members?.length ?? 0} members
                  </span>
                </button>
              ))}
            </div>
            {selectedGroup && (canManagePermissions || canManageMembers) ? (
              (() => {
                const group = groups.find((item) => item.id === selectedGroup);
                if (!group) return null;
                const enabled = new Set(
                  (group.permissions ?? [])
                    .filter((item) => item.effect === "allow")
                    .map((item) => item.permission?.permission_key),
                );
                return (
                  <div className="grid gap-4 rounded-xl border border-[var(--color-border-warm)] bg-white p-4">
                    {canManageMembers ? (
                      <fieldset className="grid gap-2 border-b border-[var(--color-border-warm)] pb-4">
                        <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[#46536b]">
                          Members
                        </legend>
                        {users.map((user) => {
                          const memberIds = new Set(
                            (group.members ?? []).map((member) => member.user_id),
                          );
                          return (
                            <label
                              key={user.id}
                              className="flex items-center gap-2 text-sm text-[#051838]"
                            >
                              <input
                                type="checkbox"
                                checked={memberIds.has(user.id)}
                                disabled={saving}
                                onChange={(event) => {
                                  const next = new Set(memberIds);
                                  if (event.target.checked) next.add(user.id);
                                  else next.delete(user.id);
                                  void saveMembers(group, [...next]);
                                }}
                                className="size-4 accent-[#051838]"
                              />
                              {user.displayName}{" "}
                              <span className="text-xs text-[#46536b]">{user.email}</span>
                            </label>
                          );
                        })}
                      </fieldset>
                    ) : null}
                    {canManagePermissions
                      ? [...new Set(permissionOptions.map((item) => item.area))].map((area) => (
                          <fieldset key={area} className="grid gap-2">
                            <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[#46536b]">
                              {area}
                            </legend>
                            {permissionOptions
                              .filter((item) => item.area === area)
                              .map((item) => (
                                <label
                                  key={item.key}
                                  className="flex items-center gap-2 text-sm text-[#051838]"
                                >
                                  <input
                                    type="checkbox"
                                    checked={enabled.has(item.key)}
                                    disabled={group.is_protected || saving}
                                    onChange={(event) =>
                                      void savePermissions(group, item.key, event.target.checked)
                                    }
                                    className="size-4 accent-[#051838]"
                                  />
                                  {item.label}
                                </label>
                              ))}
                          </fieldset>
                        ))
                      : null}
                  </div>
                );
              })()
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--color-border-warm)] p-5 text-sm text-[#46536b]">
                Select a group to review its server-backed permissions.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

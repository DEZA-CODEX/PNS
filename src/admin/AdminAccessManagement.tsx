"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { userpageApi, type UserListParams, type UserPageGroup, type UserPageUser } from "@/services/userpageApi";

type Props = { permissions: string[]; currentUserRole?: string };
type FormState = { display_name: string; email: string; group_id: string; password: string; confirmPassword: string };

const emptyForm: FormState = { display_name: "", email: "", group_id: "", password: "", confirmPassword: "" };

export function AdminAccessManagement({ permissions }: Props) {
  const [users, setUsers] = useState<UserPageUser[]>([]);
  const [groups, setGroups] = useState<UserPageGroup[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const [groupId, setGroupId] = useState("");
  const [accessLevel, setAccessLevel] = useState("");
  const [accessLevels, setAccessLevels] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", description: "" });
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [permissionCatalog, setPermissionCatalog] = useState<Array<{ permission_key: string; label: string; area: string }>>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const canCreate = permissions.includes("users.create");
  const canUpdate = permissions.includes("users.update");
  const canDelete = permissions.includes("users.disable");

  const loadGroups = useCallback(async () => {
    if (!permissions.includes("groups.read")) return;
    const [groupResult, levelResult, permissionResult] = await Promise.all([
      userpageApi.getGroups(),
      userpageApi.getAccessLevels(),
      userpageApi.getPermissions(),
    ]);
    setGroups(groupResult.groups);
    setAccessLevels(levelResult.accessLevels);
    setPermissionCatalog(permissionResult.permissions);
  }, [permissions]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: UserListParams = { page, page_size: 10 };
      if (search.trim()) params.search = search.trim();
      if (groupId) params.group_id = groupId;
      if (status !== "all") params.status = status;
      if (accessLevel) params.access_level = accessLevel;
      const result = await userpageApi.getUsers(params);
      setUsers(result.items);
      setTotalPages(Math.max(1, result.pagination.total_pages));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Users could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessLevel, groupId, page, search, status]);

  useEffect(() => { void loadGroups().catch((reason) => setError(reason instanceof Error ? reason.message : "Groups could not be loaded.")); }, [loadGroups]);
  useEffect(() => { const timer = window.setTimeout(() => void loadUsers(), 300); return () => window.clearTimeout(timer); }, [loadUsers]);

  const reset = () => { setSearch(""); setGroupId(""); setStatus("all"); setAccessLevel(""); setPage(1); };
  const updateForm = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const validate = () => {
    if (!form.display_name.trim()) return "Display name is required";
    if (!form.email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Enter a valid email address";
    if (!form.group_id) return "Please select a user group";
    if (!form.password) return "Password is required";
    if (!form.confirmPassword) return "Please confirm your password";
    if (form.password !== form.confirmPassword) return "Passwords do not match";
    return form.password.length < 8 ? "Password must be at least 8 characters" : "";
  };
  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setSaving(true); setError("");
    try {
      await userpageApi.addUser({ display_name: form.display_name.trim(), email: form.email.trim(), group_id: form.group_id, password: form.password });
      setForm(emptyForm); setShowForm(false); setMessage("User created successfully."); setPage(1); await loadUsers();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "User could not be created."); }
    finally { setSaving(false); }
  };
  const deleteUser = async (user: UserPageUser) => {
    if (!window.confirm(`Delete ${user.displayName} (${user.email})?`)) return;
    setSaving(true); setError("");
    try { await userpageApi.deleteUser(user.id); setMessage("User deleted successfully."); await loadUsers(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "User could not be deleted."); }
    finally { setSaving(false); }
  };
  const toggleStatus = async (user: UserPageUser) => {
    setSaving(true); setError("");
    try {
      await userpageApi.editAccess(user.id, { status: user.status === "active" ? "disabled" : "active" });
      setMessage("User access updated successfully."); await loadUsers();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "User access could not be updated."); }
    finally { setSaving(false); }
  };
  const groupOptions = useMemo(() => groups.filter((group) => group.is_active), [groups]);
  const openPermissionEditor = async (group: UserPageGroup) => {
    setError("");
    setEditingGroupId(group.id);
    try {
      const result = await userpageApi.getGroupPermissions(group.id);
      setSelectedPermissions(result.permissions.filter((item) => item.effect === "allow").map((item) => item.permission.permission_key));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Group permissions could not be loaded.");
    }
  };
  const saveGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupForm.name.trim()) { setError("Group name is required."); return; }
    setSaving(true); setError("");
    try {
      if (editingGroupId) await userpageApi.updateGroup(editingGroupId, { name: groupForm.name.trim(), description: groupForm.description.trim() });
      else await userpageApi.createGroup({ name: groupForm.name.trim(), description: groupForm.description.trim() });
      setGroupForm({ name: "", description: "" }); setShowGroupForm(false); setMessage(editingGroupId ? "Group updated successfully." : "Group created successfully."); setEditingGroupId(null); await loadGroups();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Group could not be saved."); }
    finally { setSaving(false); }
  };
  const savePermissions = async (group: UserPageGroup) => {
    setSaving(true); setError("");
    try {
      await userpageApi.editPermissions(group.id, selectedPermissions.map((permissionKey) => ({ permissionKey, effect: "allow" as const })));
      setMessage("Group permissions updated successfully."); setEditingGroupId(null); await loadGroups();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Group permissions could not be updated."); }
    finally { setSaving(false); }
  };
  const removeGroup = async (group: UserPageGroup) => {
    if (!window.confirm(`Delete the group "${group.name}"?`)) return;
    setSaving(true); setError("");
    try { await userpageApi.deleteGroup(group.id); setMessage("Group deleted successfully."); await loadGroups(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Group could not be deleted."); }
    finally { setSaving(false); }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-xs uppercase tracking-[0.16em] text-[var(--color-gold)]">Administration</p><h2 className="mt-2 text-3xl text-[#051838]">Users and Groups</h2><p className="mt-2 text-sm text-slate-600">Manage system users, assign groups, and control access permissions.</p></div>
        {canCreate && <button type="button" onClick={() => { setError(""); setShowForm(true); }} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#051838] px-4 py-3 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add User</button>}
      </div>
      {(message || error) && <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search users by name or email..." className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#051838]" /></label>
          <select value={groupId} onChange={(event) => { setGroupId(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 px-3 text-sm"><option value="">All Groups</option>{groupOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
          <select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }} className="rounded-lg border border-slate-200 px-3 text-sm"><option value="all">All Status</option><option value="active">Active</option><option value="disabled">Disabled</option></select>
          <select value={accessLevel} onChange={(event) => { setAccessLevel(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 px-3 text-sm"><option value="">All Access Levels</option>{accessLevels.map((level) => <option key={level}>{level}</option>)}</select>
          <button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Reset</button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Display Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Group(s)</th><th className="px-4 py-3">Access Level</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created On</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading users...</td></tr> : users.length === 0 ? <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No users match your search or filters.</td></tr> : users.map((user, index) => <tr key={user.id} className="hover:bg-slate-50"><td className="px-4 py-3 text-slate-500">{(page - 1) * 10 + index + 1}</td><td className="px-4 py-3 font-medium text-[#051838]">{user.displayName}</td><td className="px-4 py-3">{user.email}</td><td className="px-4 py-3">{user.groups?.map((group) => group.name).join(", ") || "—"}</td><td className="px-4 py-3">{user.accessLevel || user.roleName}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${user.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{user.status === "active" ? "Active" : "Disabled"}</span></td><td className="px-4 py-3">{new Date(user.createdAt).toLocaleDateString()}</td><td className="px-4 py-3"><div className="flex items-center gap-2">{canUpdate && <button type="button" title="Enable or disable user" disabled={saving} onClick={() => void toggleStatus(user)} className="text-slate-500 hover:text-[#051838]"><Pencil className="h-4 w-4" /></button>}{canDelete && <button type="button" title="Delete user" disabled={saving} onClick={() => void deleteUser(user)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>}</div></td></tr>)}</tbody>
        </table></div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600"><span>Page {page} of {totalPages}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button></div></div>
      </div>
      {permissions.includes("groups.read") && <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-lg font-semibold text-[#051838]">Groups &amp; Permissions</h3><p className="mt-1 text-sm text-slate-500">Create groups and choose exactly which actions members can perform.</p></div>{permissions.includes("groups.create") && <button type="button" onClick={() => { setEditingGroupId(null); setGroupForm({ name: "", description: "" }); setShowGroupForm(true); }} className="inline-flex items-center gap-2 rounded-lg bg-[#051838] px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New Group</button>}</div><div className="mt-4 grid gap-3 md:grid-cols-2">{groups.map((group) => <div key={group.id} className="rounded-lg border border-slate-200 p-4"><div className="flex items-start justify-between gap-2"><div><strong>{group.name}</strong><p className="mt-1 text-sm text-slate-500">{group.description || "No description"}</p></div><span className="text-xs text-slate-500">{group.member_count} members</span></div><p className="mt-3 text-xs text-slate-500">{group.permissions?.filter((item) => item.effect === "allow").length ?? 0} enabled permissions</p><div className="mt-4 flex gap-2">{permissions.includes("groups.permissions.manage") && !group.is_protected && <button type="button" onClick={() => void openPermissionEditor(group)} className="rounded border border-[#051838] px-3 py-1.5 text-xs font-medium text-[#051838]">Edit Permissions</button>}{permissions.includes("groups.update") && !group.is_protected && <button type="button" onClick={() => { setEditingGroupId(group.id); setGroupForm({ name: group.name, description: group.description }); setShowGroupForm(true); }} className="rounded border px-3 py-1.5 text-xs">Edit Group</button>}{permissions.includes("groups.delete") && !group.is_protected && <button type="button" disabled={saving} onClick={() => void removeGroup(group)} className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-600">Delete</button>}</div></div>)}</div></div>}
      {showGroupForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#051838]/50 p-4"><form onSubmit={saveGroup} className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><h3 className="text-xl font-semibold text-[#051838]">{editingGroupId ? "Edit Group" : "Create Group"}</h3><button type="button" onClick={() => setShowGroupForm(false)} aria-label="Close"><X /></button></div><label className="block text-sm font-medium">Group Name *<input required value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="block text-sm font-medium">Description<textarea value={groupForm.description} onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" rows={3} /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowGroupForm(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button disabled={saving} type="submit" className="rounded-lg bg-[#051838] px-4 py-2 text-sm font-semibold text-white">{saving ? "Saving..." : "Save Group"}</button></div></form></div>}
      {editingGroupId && !showGroupForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#051838]/50 p-4"><div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><div><h3 className="text-xl font-semibold text-[#051838]">Edit Group Permissions</h3><p className="mt-1 text-sm text-slate-500">Enable the actions members of this group may perform.</p></div><button type="button" onClick={() => setEditingGroupId(null)} aria-label="Close"><X /></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{permissionCatalog.map((permission) => <label key={permission.permission_key} className="flex items-start gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" checked={selectedPermissions.includes(permission.permission_key)} onChange={(event) => setSelectedPermissions((current) => event.target.checked ? [...current, permission.permission_key] : current.filter((key) => key !== permission.permission_key))} className="mt-1" /><span><strong>{permission.label}</strong><span className="block text-xs text-slate-500">{permission.area} · {permission.permission_key}</span></span></label>)}</div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setEditingGroupId(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button type="button" disabled={saving} onClick={() => { const group = groups.find((item) => item.id === editingGroupId); if (group) void savePermissions(group); }} className="rounded-lg bg-[#051838] px-4 py-2 text-sm font-semibold text-white">{saving ? "Saving..." : "Save Permissions"}</button></div></div></div>}
      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#051838]/50 p-4"><form onSubmit={createUser} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><h3 className="text-xl font-semibold text-[#051838]">Add User</h3><button type="button" onClick={() => setShowForm(false)} aria-label="Close"><X /></button></div>{(["display_name", "email"] as const).map((field) => <label key={field} className="block text-sm font-medium text-slate-700">{field === "display_name" ? "Display Name" : "Email"} *<input required value={form[field]} onChange={(event) => updateForm(field, event.target.value)} type={field === "email" ? "email" : "text"} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>)}<label className="block text-sm font-medium text-slate-700">User Group *<select required value={form.group_id} onChange={(event) => updateForm("group_id", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">Select a group</option>{groupOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{(["password", "confirmPassword"] as const).map((field) => <label key={field} className="block text-sm font-medium text-slate-700">{field === "password" ? "Password" : "Confirm Password"} *<input required minLength={8} type="password" value={form[field]} onChange={(event) => updateForm(field, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>)}<div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button disabled={saving} type="submit" className="rounded-lg bg-[#051838] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating..." : "Create User"}</button></div></form></div>}
    </section>
  );
}

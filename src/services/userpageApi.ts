import { apiFetch } from "@/lib/api-client";
import type { AdminUserStatus } from "@/lib/admin-types";

export type UserPageGroup = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  is_protected: boolean;
  member_count: number;
  members: Array<{ user_id: string }>;
  permissions: Array<{
    effect: "allow" | "deny";
    permission: { permission_key: string; label: string; area: string };
  }>;
};

export type UserPageUser = {
  id: string;
  email: string;
  displayName: string;
  status: AdminUserStatus;
  roleName: string;
  accessLevel?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  groups?: Array<{ id: string; name: string }>;
};

export type UserPagePermission = {
  permission_key: string;
  label: string;
  area: string;
};

export type UserListParams = {
  search?: string;
  group_id?: string;
  status?: "active" | "disabled";
  access_level?: string;
  page?: number;
  page_size?: number;
};

export type UserListResult = {
  items: UserPageUser[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
};

export class UserpageApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "UserpageApiError";
  }
}

type ApiEnvelope<T> = T & {
  error?: { code?: string; message?: string };
};

async function request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await apiFetch(`/userpage${path}`, init);
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok) {
    const code = payload.error?.code;
    let message = payload.error?.message ?? "The request could not be completed.";
    if (response.status === 401) message = "Your session has expired. Please log in again.";
    else if (response.status === 403) message = "You do not have permission to perform this action.";
    else if (response.status === 404) message = "The requested user or group could not be found.";
    else if (response.status === 409 && code === "conflict") {
      message = payload.error?.message ?? "A user with this email already exists.";
    } else if (response.status === 500) {
      message = "Something went wrong while processing your request. Please try again.";
    } else if (response.status === 503) {
      message = "The user management service is temporarily unavailable. Please try again later.";
    }
    throw new UserpageApiError(message, response.status, code);
  }
  return payload;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export const userpageApi = {
  async getUsers(params: UserListParams = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    const result = await request<UserListResult>(`/users?${query.toString()}`);
    return result;
  },
  async getUser(userId: string) {
    return request<{ user: UserPageUser; memberships: Array<{ group: { id: string; name: string } }>; directPermissions: unknown[] }>(
      `/users/${encodeURIComponent(userId)}`,
    );
  },
  async addUser(payload: { display_name: string; email: string; group_id: string; password: string }) {
    return request<{ user: UserPageUser }>("/adduser", json("POST", payload));
  },
  async deleteUser(userId: string) {
    return request(`/deluser/${encodeURIComponent(userId)}`, { method: "DELETE" });
  },
  async editAccess(userId: string, payload: { group_ids?: string[]; status?: AdminUserStatus }) {
    return request<{ user: UserPageUser }>(
      `/editaccess/${encodeURIComponent(userId)}`,
      json("PATCH", payload),
    );
  },
  async updateUser(userId: string, payload: { display_name: string }) {
    return request<{ user: UserPageUser }>(
      `/edituser/${encodeURIComponent(userId)}`,
      json("PATCH", payload),
    );
  },
  async enableUser(userId: string) {
    return request<{ user: UserPageUser }>(`/enableuser/${encodeURIComponent(userId)}`, { method: "PATCH" });
  },
  async disableUser(userId: string) {
    return request<{ user: UserPageUser }>(`/disableuser/${encodeURIComponent(userId)}`, { method: "PATCH" });
  },
  async getGroups() {
    return request<{ groups: UserPageGroup[] }>("/groups");
  },
  async getGroup(groupId: string) {
    return request<{ group: UserPageGroup }>(`/groups/${encodeURIComponent(groupId)}`);
  },
  async createGroup(payload: { name: string; description: string }) {
    return request<{ group: UserPageGroup }>("/creategroup", json("POST", payload));
  },
  async updateGroup(groupId: string, payload: { name?: string; description?: string }) {
    return request<{ group: UserPageGroup }>(
      `/editgroup/${encodeURIComponent(groupId)}`,
      json("PATCH", payload),
    );
  },
  async deleteGroup(groupId: string) {
    return request(`/delgroup/${encodeURIComponent(groupId)}`, { method: "DELETE" });
  },
  async getGroupPermissions(groupId: string) {
    return request<{ permissions: UserPageGroup["permissions"] }>(
      `/grouppermissions/${encodeURIComponent(groupId)}`,
    );
  },
  async editPermissions(groupId: string, permissions: Array<{ permissionKey: string; effect: "allow" | "deny" }>) {
    return request(
      `/editpermissions/${encodeURIComponent(groupId)}`,
      json("PATCH", { permissions }),
    );
  },
  async assignGroup(userId: string, groupId: string, assigned: boolean) {
    return request<{ user: UserPageUser }>(
      `/assigngroup/${encodeURIComponent(userId)}`,
      json("PATCH", { group_id: groupId, assigned }),
    );
  },
  async getAccessLevels() {
    return request<{ accessLevels: string[] }>("/access-levels");
  },
  async getPermissions() {
    return request<{ permissions: UserPagePermission[] }>("/permissions");
  },
};

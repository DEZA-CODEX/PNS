export type AdminPermission =
  | "room_images.read"
  | "room_images.upload"
  | "room_images.add_url"
  | "room_images.delete"
  | "dining_images.read"
  | "dining_images.upload"
  | "dining_images.add_url"
  | "dining_images.delete"
  | "users.read"
  | "users.create"
  | "users.update"
  | "users.disable"
  | "groups.read"
  | "groups.create"
  | "groups.update"
  | "groups.delete"
  | "groups.members.manage"
  | "groups.permissions.manage"
  | "audit.read";

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

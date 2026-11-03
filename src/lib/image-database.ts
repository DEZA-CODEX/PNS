import { access } from "node:fs/promises";
import path from "node:path";
import { getAdminDb, hasSupabaseConfig } from "@/lib/admin-auth";
import type { ImageCollection, ImageSourceType, ManagedImage } from "@/lib/image-management";

async function storageFileExists(relativePath: string | null) {
  if (!relativePath) return false;
  const normalized = relativePath.replace(/^\/+/, "").replace(/^uploads\//u, "");
  const resolved = path.resolve(process.cwd(), "public", normalized);
  try {
    await access(resolved);
    return true;
  } catch {
    return false;
  }
}

function withCacheVersion(url: string, value: string | number | Date | null | undefined) {
  if (!url || value === null || value === undefined || value === "") {
    return url;
  }

  const version = String(value).replace(/[^A-Za-z0-9_-]/g, "");
  if (!version) return url;

  try {
    const parsed = new URL(url, "https://pns.local");
    parsed.searchParams.set("v", version);
    return parsed.origin === "https://pns.local"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString();
  } catch {
    return url;
  }
}

export function usesDatabaseImageStore() {
  const backend = process.env["PNS_IMAGE_BACKEND"];
  if (backend === "file") return false;
  return hasSupabaseConfig();
}

export async function listDatabaseImages(
  collection: ImageCollection,
  category: string,
  displayLocation?: string,
) {
  let query = getAdminDb()
    .from("managed_images")
    .select(
      "id,category_id,public_url,storage_path,source_type,display_location,display_order,is_active,updated_at",
    )
    .eq("category_type", collection)
    .eq("category_id", category)
    .order("display_order", { ascending: true });
  if (displayLocation) query = query.eq("display_location", displayLocation);
  const { data, error } = await query;
  if (error) throw error;

  const records = await Promise.all(
    (data ?? []).map(async (row) => {
      const storagePath = row.storage_path ? String(row.storage_path) : null;
      const isMissingUpload =
        row.source_type === "upload" && storagePath && !(await storageFileExists(storagePath));
      return {
        id: String(row.id),
        category: String(row.category_id),
        url: isMissingUpload
          ? ""
          : withCacheVersion(String(row.public_url), row.updated_at ?? row.id),
        path: isMissingUpload ? null : storagePath,
        sourceType: row.source_type as ImageSourceType,
        filename: storagePath ? (String(storagePath).split("/").pop() ?? null) : null,
        active: Boolean(row.is_active),
        displayOrder: Number(row.display_order ?? 0),
        displayLocation: String(row.display_location ?? "gallery"),
        updatedAt: row.updated_at ? String(row.updated_at) : undefined,
      } as ManagedImage & { active: boolean; displayOrder: number; updatedAt?: string };
    }),
  );

  return records.filter((record) => {
    if (record.sourceType !== "upload") return true;
    return record.url !== "";
  });
}

function normalizeUuidLike(value: string | null | undefined) {
  if (!value) return null;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value)
    ? value
    : null;
}

export async function saveDatabaseImage(input: {
  collection: ImageCollection;
  category: string;
  url: string;
  path: string | null;
  sourceType: ImageSourceType;
  displayLocation?: string;
  createdBy?: string | null;
  legacyId?: string;
}) {
  const { data, error } = await getAdminDb()
    .from("managed_images")
    .insert({
      category_type: input.collection,
      category_id: input.category,
      public_url: input.url,
      storage_path: input.path,
      source_type: input.sourceType,
      display_location: input.displayLocation ?? "gallery",
      created_by: normalizeUuidLike(input.createdBy),
      legacy_id: input.legacyId ?? null,
    })
    .select(
      "id,category_id,public_url,storage_path,source_type,display_location,display_order,is_active,updated_at",
    )
    .single();
  if (error) throw error;
  return {
    id: String(data.id),
    category: String(data.category_id),
    url: withCacheVersion(String(data.public_url), data.updated_at ?? data.id),
    path: data.storage_path ? String(data.storage_path) : null,
    sourceType: data.source_type as ImageSourceType,
    filename: data.storage_path ? (String(data.storage_path).split("/").pop() ?? null) : null,
    active: Boolean(data.is_active),
    displayOrder: Number(data.display_order ?? 0),
    displayLocation: String(data.display_location ?? "gallery"),
    updatedAt: data.updated_at ? String(data.updated_at) : undefined,
  } as ManagedImage & { active: boolean; displayOrder: number; updatedAt?: string };
}

export async function disableDatabaseImage(
  collection: ImageCollection,
  category: string,
  id: string,
) {
  const { data, error } = await getAdminDb()
    .from("managed_images")
    .update({ is_active: false })
    .eq("id", id)
    .eq("category_type", collection)
    .eq("category_id", category)
    .eq("is_active", true)
    .select("id,storage_path,source_type")
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; storage_path: string | null; source_type: ImageSourceType } | null;
}

export async function disableBundledImage(
  collection: ImageCollection,
  category: string,
  image: ManagedImage,
  createdBy?: string,
) {
  return saveDatabaseImage({
    collection,
    category,
    url: image.url,
    path: image.path,
    sourceType: "bundled",
    legacyId: image.id,
    createdBy: createdBy ?? null,
  });
}

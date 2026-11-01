import { access } from "node:fs/promises";
import path from "node:path";
import { getAdminDb, hasSupabaseConfig } from "@/lib/admin-auth";
import type { ImageCollection, ImageSourceType, ManagedImage } from "@/lib/image-management";

async function storageFileExists(relativePath: string | null) {
  if (!relativePath) return false;
  const normalized = relativePath.replace(/^\/+/u, "").replace(/^uploads\//u, "");
  const resolved = path.resolve(process.cwd(), "public", normalized);
  try {
    await access(resolved);
    return true;
  } catch {
    return false;
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
      "id,category_id,public_url,storage_path,source_type,display_location,display_order,is_active",
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
        url: isMissingUpload ? "" : String(row.public_url),
        path: isMissingUpload ? null : storagePath,
        sourceType: row.source_type as ImageSourceType,
        filename: storagePath ? (String(storagePath).split("/").pop() ?? null) : null,
        active: Boolean(row.is_active),
        displayOrder: Number(row.display_order ?? 0),
        displayLocation: String(row.display_location ?? "gallery"),
      } as ManagedImage & { active: boolean; displayOrder: number };
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
      "id,category_id,public_url,storage_path,source_type,display_location,display_order,is_active",
    )
    .single();
  if (error) throw error;
  return {
    id: String(data.id),
    category: String(data.category_id),
    url: String(data.public_url),
    path: data.storage_path ? String(data.storage_path) : null,
    sourceType: data.source_type as ImageSourceType,
    filename: data.storage_path ? (String(data.storage_path).split("/").pop() ?? null) : null,
    active: Boolean(data.is_active),
    displayOrder: Number(data.display_order ?? 0),
    displayLocation: String(data.display_location ?? "gallery"),
  } as ManagedImage & { active: boolean; displayOrder: number };
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

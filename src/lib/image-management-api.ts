import {
  AdminAuthError,
  requirePermission,
  type AdminPermission,
  writeAuditEvent,
} from "@/lib/admin-auth";
import {
  addExternalImage,
  addUploadedImage,
  addUploadedImages,
  deleteManagedImage,
  ImageManagementError,
  isCollection,
  listManagedImages,
  type ImageCollection,
} from "@/lib/image-management";
function errorResponse(error: unknown, requestId: string) {
  if (error instanceof AdminAuthError) {
    return Response.json(
      { success: false, requestId, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ImageManagementError) {
    return Response.json(
      { success: false, requestId, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error(`[image-management:${requestId}] unexpected storage failure`);
  return Response.json(
    {
      success: false,
      requestId,
      error: { code: "server_error", message: "The image operation could not be completed." },
    },
    { status: 500 },
  );
}

function collectionFromRoute(value: string): ImageCollection {
  const collection = value.replace(/-images$/, "");
  if (!isCollection(collection))
    throw new ImageManagementError("invalid_collection", "The image collection is invalid.", 400);
  return collection;
}

export async function handleList(request: Request, routeCollection: string) {
  const requestId = crypto.randomUUID();
  try {
    const collection = collectionFromRoute(routeCollection);
    const authContext = await requirePermission(
      request,
      `${collection}_images.read` as AdminPermission,
    );
    const category = new URL(request.url).searchParams.get("type")?.trim() ?? "";
    const images = await listManagedImages(collection, category);
    await writeAuditEvent(
      authContext.user.id,
      `${collection}_images.read`,
      collection,
      category,
      "success",
      requestId,
    );
    console.info(`[image-management:${requestId}] ${collection} list ${category}`);
    return Response.json({ success: true, requestId, category, images });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function handleCreate(request: Request, routeCollection: string) {
  const requestId = crypto.randomUUID();
  try {
    const collection = collectionFromRoute(routeCollection);
    const contentType = request.headers.get("content-type") ?? "";
    const permission = contentType.includes("multipart/form-data")
      ? `${collection}_images.upload`
      : `${collection}_images.add_url`;
    const authContext = await requirePermission(request, permission as AdminPermission);
    let image;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const category = String(form.get("category") ?? "").trim();
      const fileEntries: File[] = [];
      for (const entry of form.getAll("file")) {
        if (entry instanceof File) fileEntries.push(entry);
      }
      for (const entry of form.getAll("files")) {
        if (entry instanceof File) fileEntries.push(entry);
      }
      if (fileEntries.length === 0)
        throw new ImageManagementError("missing_file", "Choose at least one image file.", 400);
      if (fileEntries.length === 1) {
        const singleFile = fileEntries[0];
        if (!singleFile) {
          throw new ImageManagementError("missing_file", "Choose at least one image file.", 400);
        }
        image = await addUploadedImage(collection, category, singleFile, authContext.user.id);
      } else {
        const batch = await addUploadedImages(
          collection,
          category,
          fileEntries,
          authContext.user.id,
        );
        const statusCode = batch.failed === 0 ? 201 : batch.processed > 0 ? 207 : 400;
        console.info(
          `[image-management:${requestId}] ${collection} batch create ${category} ${batch.processed}/${batch.total}`,
        );
        await writeAuditEvent(
          authContext.user.id,
          `${collection}_images.upload`,
          collection,
          category,
          "success",
          requestId,
          { files: batch.total, success: batch.processed, converted: batch.converted, failed: batch.failed },
        );
        return Response.json(
          {
            success: batch.failed === 0,
            requestId,
            category,
            total: batch.total,
            processed: batch.processed,
            converted: batch.converted,
            alreadyWebp: batch.alreadyWebp,
            failed: batch.failed,
            files: batch.files,
          },
          { status: statusCode },
        );
      }
    } else {
      const body = (await request.json()) as { category?: unknown; imageUrl?: unknown };
      if (typeof body.category !== "string" || typeof body.imageUrl !== "string") {
        throw new ImageManagementError(
          "invalid_payload",
          "A category and image URL are required.",
          400,
        );
      }
      image = await addExternalImage(
        collection,
        body.category.trim(),
        body.imageUrl.trim(),
        authContext.user.id,
      );
    }
    console.info(
      `[image-management:${requestId}] ${collection} create ${image.category} ${image.sourceType}`,
    );
    await writeAuditEvent(
      authContext.user.id,
      `${collection}_images.${image.sourceType === "external" ? "add_url" : "upload"}`,
      collection,
      image.category,
      "success",
      requestId,
      { sourceType: image.sourceType },
    );
    return Response.json(
      { success: true, requestId, category: image.category, image },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function handleDelete(request: Request, routeCollection: string, routeId: string) {
  const requestId = crypto.randomUUID();
  try {
    const collection = collectionFromRoute(routeCollection);
    const authContext = await requirePermission(
      request,
      `${collection}_images.delete` as AdminPermission,
    );
    const category = new URL(request.url).searchParams.get("type")?.trim() ?? "";
    await deleteManagedImage(collection, category, routeId, authContext.user.id);
    console.info(`[image-management:${requestId}] ${collection} delete ${category}`);
    await writeAuditEvent(
      authContext.user.id,
      `${collection}_images.delete`,
      collection,
      routeId,
      "success",
      requestId,
    );
    return Response.json({ success: true, requestId, category, id: routeId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function handlePublicList(request: Request, routeCollection: string) {
  const requestId = crypto.randomUUID();
  try {
    const collection = collectionFromRoute(routeCollection);
    const category = new URL(request.url).searchParams.get("type")?.trim() ?? "";
    const displayLocation = new URL(request.url).searchParams.get("location")?.trim() || undefined;
    const images = await listManagedImages(collection, category, displayLocation);
    return Response.json(
      { success: true, requestId, category, images },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

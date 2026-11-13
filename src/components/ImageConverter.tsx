"use client";

import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  FileImage,
  LoaderCircle,
  Play,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { converterFetch } from "@/lib/converter-client";

type ConversionStatus = "Waiting" | "Processing" | "Completed" | "Failed";

type ConversionItem = {
  id: string;
  file: File;
  index: number;
  fileId: string | null;
  outputName: string | null;
  status: ConversionStatus;
  convertedSize: number | null;
  reductionBytes: number | null;
  reductionPercent: number | null;
  error: string | null;
};

type ServerItem = {
  index: number;
  file_id: string;
  original_name: string;
  original_size: number;
  output_name?: string | null;
  status: "waiting" | "processing" | "completed" | "failed";
  converted_size?: number | null;
  reduction_bytes?: number | null;
  reduction_percent?: number | null;
  error?: string | null;
};

type BatchStatus = {
  batch_id: string;
  status: "queued" | "processing" | "completed" | "cancelled";
  images: ServerItem[];
};

const ACCEPTED_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/iu;
const ACCEPTED_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

function statusFromServer(status: ServerItem["status"]): ConversionStatus {
  return (status.charAt(0).toUpperCase() + status.slice(1)) as ConversionStatus;
}

function formatBytes(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function createItem(file: File, index: number): ConversionItem {
  return {
    id: crypto.randomUUID(),
    file,
    index,
    fileId: null,
    outputName: null,
    status: "Waiting",
    convertedSize: null,
    reductionBytes: null,
    reductionPercent: null,
    error: null,
  };
}

function mergeServerItem(items: ConversionItem[], serverItem: ServerItem) {
  return items.map((item) =>
    item.index === serverItem.index
      ? {
          ...item,
          fileId: serverItem.file_id || item.fileId,
          outputName: serverItem.output_name || item.outputName,
          status: statusFromServer(serverItem.status),
          convertedSize: serverItem.converted_size ?? item.convertedSize,
          reductionBytes: serverItem.reduction_bytes ?? item.reductionBytes,
          reductionPercent: serverItem.reduction_percent ?? item.reductionPercent,
          error: serverItem.error ?? null,
        }
      : item,
  );
}

async function downloadResponse(path: string, filename: string) {
  const response = await converterFetch(path);
  if (!response.ok) {
    throw new Error("The converted download is no longer available.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function ImageConverter() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<ConversionItem[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const summary = useMemo(() => {
    const completed = items.filter((item) => item.status === "Completed").length;
    const failed = items.filter((item) => item.status === "Failed").length;
    const processing = items.filter((item) => item.status === "Processing").length;
    const waiting = items.filter((item) => item.status === "Waiting").length;
    return {
      total: items.length,
      completed,
      failed,
      processing,
      waiting,
      progress: items.length ? Math.round(((completed + failed) / items.length) * 100) : 0,
    };
  }, [items]);

  const addFiles = (selectedFiles: File[]) => {
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of selectedFiles) {
      if (ACCEPTED_TYPES.has(file.type) || ACCEPTED_EXTENSIONS.test(file.name)) {
        accepted.push(file);
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length) {
      setError(`Unsupported file type: ${rejected.join(", ")}`);
    } else {
      setError(null);
    }
    if (accepted.length) {
      setItems((current) => [
        ...current,
        ...accepted.map((file, offset) => createItem(file, current.length + offset)),
      ]);
      setNotice(`${accepted.length} image${accepted.length === 1 ? "" : "s"} added to the queue.`);
      setBatchId(null);
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const removeItem = (id: string) => {
    if (isConverting) return;
    setItems((current) =>
      current.filter((item) => item.id !== id).map((item, index) => ({ ...item, index })),
    );
    setBatchId(null);
  };

  const clearQueue = async () => {
    if (isConverting) return;
    if (batchId) {
      try {
        await converterFetch(`/convert/${encodeURIComponent(batchId)}`, { method: "DELETE" });
      } catch {
        setNotice("The local queue was cleared; the temporary batch will expire automatically.");
      }
    }
    setItems([]);
    setBatchId(null);
    setError(null);
    setNotice(null);
  };

  const startConversion = async () => {
    if (!items.length || isConverting) return;
    setIsConverting(true);
    setError(null);
    setNotice("Processing images in selection order...");
    setBatchId(null);
    setItems((current) =>
      current.map((item) => ({
        ...item,
        status: "Waiting",
        fileId: null,
        outputName: null,
        convertedSize: null,
        reductionBytes: null,
        reductionPercent: null,
        error: null,
      })),
    );

    try {
      const form = new FormData();
      for (const item of items) {
        form.append("files", item.file, item.file.name);
      }
      const response = await converterFetch("/convert/", { method: "POST", body: form });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "The conversion batch could not be started.");
      }
      const created = (await response.json()) as { batch_id?: string };
      if (!created.batch_id) throw new Error("The conversion batch ID was missing.");
      const createdBatchId = created.batch_id;
      setBatchId(createdBatchId);
      setNotice("Batch queued. Processing will continue in selection order...");

      while (true) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await converterFetch(
          `/convert/${encodeURIComponent(createdBatchId)}/status`,
        );
        if (!statusResponse.ok) {
          throw new Error("The conversion status is no longer available.");
        }
        const status = (await statusResponse.json()) as BatchStatus;
        setItems((current) =>
          status.images.reduce((updated, item) => mergeServerItem(updated, item), current),
        );
        if (status.status === "completed") {
          setNotice("Conversion complete. Download the files individually or as one ZIP.");
          break;
        }
        if (status.status === "cancelled") {
          setNotice("The conversion batch was cancelled.");
          break;
        }
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The conversion was interrupted.");
      setNotice(null);
    } finally {
      setIsConverting(false);
    }
  };

  const downloadItem = async (item: ConversionItem) => {
    if (!batchId || !item.fileId || item.status !== "Completed") return;
    setDownloading(item.id);
    setError(null);
    try {
      await downloadResponse(
        `/convert/${encodeURIComponent(batchId)}/files/${encodeURIComponent(item.fileId)}`,
        item.outputName ?? `${item.file.name}.webp`,
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The file could not be downloaded.");
    } finally {
      setDownloading(null);
    }
  };

  const downloadAll = async () => {
    if (!batchId || !summary.completed) return;
    setDownloading("all");
    setError(null);
    try {
      await downloadResponse(
        `/convert/${encodeURIComponent(batchId)}/download-all`,
        "converted-images.zip",
      );
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : "The ZIP archive could not be downloaded.",
      );
    } finally {
      setDownloading(null);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--color-surface-cool)] px-4 py-8 text-[var(--color-text-primary)] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 border-b border-[var(--color-border-warm)] pb-6">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-gold)]">
            PNS utility
          </p>
          <h1 className="mt-2 text-4xl leading-tight sm:text-5xl">Image to WebP Converter</h1>
          <p className="mt-3 max-w-2xl text-sm text-[#46536b]">
            Convert a large image selection in order, keep every result private and temporary, and
            download the WebP files when you are ready.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-6">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                addFiles(Array.from(event.dataTransfer.files));
              }}
              className={`rounded-3xl border-2 border-dashed p-8 text-center transition-colors ${
                isDragging
                  ? "border-[var(--color-gold)] bg-white"
                  : "border-[var(--color-border-warm)] bg-white/55"
              }`}
            >
              <UploadCloud className="mx-auto h-10 w-10 text-[var(--color-gold)]" />
              <h2 className="mt-4 text-2xl">Drop images here</h2>
              <p className="mt-2 text-sm text-[#46536b]">
                or choose 20, 50, or more images at once
              </p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={isConverting}
                className="mt-5 rounded-full bg-[#051838] px-5 py-3 text-xs uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Select images
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/avif,image/bmp,image/gif,image/jpeg,image/png,image/tiff,image/webp"
                onChange={handleFileInput}
                className="hidden"
              />
              <p className="mt-4 text-xs text-[#46536b]">
                JPEG, PNG, WebP, GIF, TIFF, BMP, and AVIF
              </p>
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
            {notice ? (
              <p role="status" className="text-sm text-[#46536b]">
                {notice}
              </p>
            ) : null}

            <div className="rounded-3xl border border-[var(--color-border-warm)] bg-white/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-gold)]">
                    FIFO queue
                  </p>
                  <h2 className="mt-1 text-2xl">Selected images ({summary.total})</h2>
                </div>
                <button
                  type="button"
                  onClick={() => void clearQueue()}
                  disabled={!items.length || isConverting}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-warm)] px-4 py-2 text-xs uppercase tracking-[0.1em] disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear queue
                </button>
              </div>

              {items.length ? (
                <div className="mt-5 space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-3 rounded-xl border border-[var(--color-border-warm)] bg-white/70 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef2f5] text-xs font-semibold text-[#051838]">
                        {item.index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <FileImage className="h-4 w-4 shrink-0 text-[var(--color-gold)]" />
                          <p className="truncate text-sm font-medium">{item.file.name}</p>
                        </div>
                        <p className="mt-1 text-xs text-[#46536b]">
                          {formatBytes(item.file.size)} · {item.status}
                          {item.status === "Completed" && item.convertedSize !== null
                            ? ` · ${formatBytes(item.convertedSize)} · ${item.reductionPercent}% change`
                            : ""}
                        </p>
                        {item.error ? (
                          <p className="mt-1 text-xs text-red-700">{item.error}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        {item.status === "Processing" ? (
                          <LoaderCircle
                            className="h-4 w-4 animate-spin text-[var(--color-gold)]"
                            aria-label="Processing"
                          />
                        ) : item.status === "Completed" ? (
                          <button
                            type="button"
                            onClick={() => void downloadItem(item)}
                            disabled={downloading !== null}
                            className="inline-flex items-center gap-1.5 rounded-full bg-[#051838] px-3 py-2 text-xs text-white disabled:opacity-50"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </button>
                        ) : item.status === "Failed" ? (
                          <AlertCircle className="h-4 w-4 text-red-700" aria-label="Failed" />
                        ) : null}
                        {!isConverting ? (
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            aria-label={`Remove ${item.file.name}`}
                            className="rounded-full p-2 text-[#46536b] hover:bg-[#eef2f5]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 rounded-xl border border-dashed border-[var(--color-border-warm)] p-8 text-center text-sm text-[#46536b]">
                  Your selected images will appear here in their processing order.
                </p>
              )}
            </div>
          </div>

          <aside className="h-fit space-y-4 rounded-3xl bg-[#051838] p-5 text-white lg:sticky lg:top-6">
            <p className="text-xs uppercase tracking-[0.14em] text-[#d9ae78]">Conversion summary</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Total", summary.total],
                ["Waiting", summary.waiting],
                ["Processing", summary.processing],
                ["Completed", summary.completed],
                ["Failed", summary.failed],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-white/8 p-3">
                  <p className="text-xs text-white/65">{label}</p>
                  <p className="mt-1 text-2xl">{value}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="flex justify-between text-xs text-white/70">
                <span>Overall progress</span>
                <span>{summary.progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-[#d9ae78] transition-all"
                  style={{ width: `${summary.progress}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void startConversion()}
              disabled={!items.length || isConverting}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#d9ae78] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#051838] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isConverting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isConverting ? "Converting..." : "Start conversion"}
            </button>
            <button
              type="button"
              onClick={() => void downloadAll()}
              disabled={!summary.completed || downloading !== null}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-white/25 px-4 py-3 text-xs uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Archive className="h-4 w-4" /> Download all ({summary.completed})
            </button>
            {summary.completed ? (
              <p className="flex items-center gap-2 text-xs text-white/70">
                <CheckCircle2 className="h-4 w-4 text-[#d9ae78]" />
                {summary.completed} WebP {summary.completed === 1 ? "file is" : "files are"} ready.
              </p>
            ) : null}
            <p className="text-xs leading-relaxed text-white/55">
              Files are processed one at a time in the order shown. Temporary results expire
              automatically.
            </p>
          </aside>
        </section>
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Job = {
  id: string;
  taskId: string;
  type: string;
  queue: string;
  status: "pending" | "queued" | "processing" | "completed" | "failed" | "retrying" | "cancelled";
  progress: number;
  resultSummary: string | null;
  error: string | null;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const activeStatuses = new Set<Job["status"]>(["pending", "queued", "processing", "retrying"]);

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function AdminBackgroundJobs({ canCreate }: { canCreate: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadJobs = useCallback(async () => {
    try {
      const response = await apiFetch("/admin/jobs?page=1&page_size=30", { timeoutMs: 8_000 });
      if (!response.ok) throw new Error(`Jobs could not be loaded (HTTP ${response.status}).`);
      const payload = (await response.json()) as { jobs?: Job[] };
      if (!Array.isArray(payload.jobs)) throw new Error("The jobs response was invalid.");
      setJobs(payload.jobs);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jobs could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs]);

  const hasActiveJobs = jobs.some((job) => activeStatuses.has(job.status));
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => void loadJobs(), 10_000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, loadJobs]);

  const enqueueCacheRefresh = async () => {
    setCreating(true);
    setError("");
    try {
      const response = await apiFetch("/admin/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ type: "cache.invalidate_images" }),
      });
      if (!response.ok)
        throw new Error(`The cache refresh could not be queued (HTTP ${response.status}).`);
      await loadJobs();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The cache refresh could not be queued.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--color-border-warm)] bg-white/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#051838]">Background jobs</h2>
          <p className="mt-1 text-sm text-slate-600">
            Track worker tasks and retry state. Active jobs refresh every 10 seconds.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            disabled={creating}
            onClick={() => void enqueueCacheRefresh()}
            className="rounded-lg bg-[#051838] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creating ? "Queueing..." : "Refresh image cache"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="mt-5 text-sm text-slate-600">
          Loading jobs...
        </p>
      ) : null}
      {!loading && jobs.length === 0 ? (
        <p className="mt-5 text-sm text-slate-600">No background jobs have been recorded.</p>
      ) : null}
      {jobs.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-3 pr-4">Job</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Progress</th>
                <th className="py-3 pr-4">Created</th>
                <th className="py-3 pr-4">Started</th>
                <th className="py-3">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id} className="align-top">
                  <td className="py-3 pr-4">
                    <strong className="text-[#051838]">{job.type}</strong>
                    <div className="mt-1 break-all text-xs text-slate-500">{job.id}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Queue: {job.queue} · Retries: {job.retryCount}
                    </div>
                    {job.error ? <p className="mt-1 text-xs text-red-700">{job.error}</p> : null}
                    {job.resultSummary ? (
                      <p className="mt-1 text-xs text-slate-600">{job.resultSummary}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 capitalize">{job.status}</td>
                  <td className="py-3 pr-4">{job.progress}%</td>
                  <td className="py-3 pr-4">{formatTime(job.createdAt)}</td>
                  <td className="py-3 pr-4">{formatTime(job.startedAt)}</td>
                  <td className="py-3">{formatTime(job.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

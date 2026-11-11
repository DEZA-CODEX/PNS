CREATE TABLE IF NOT EXISTS public.background_jobs (
  id uuid PRIMARY KEY,
  task_id text NOT NULL UNIQUE,
  job_type text NOT NULL CHECK (job_type IN ('cache.invalidate_images')),
  queue_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'retrying', 'cancelled')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result_summary text,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  dispatch_attempts integer NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  actor_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  dispatched_at timestamptz
);

CREATE INDEX IF NOT EXISTS background_jobs_created_at_idx
  ON public.background_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS background_jobs_status_created_at_idx
  ON public.background_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS background_jobs_completed_at_idx
  ON public.background_jobs (completed_at)
  WHERE status IN ('completed', 'failed', 'cancelled');

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS background_jobs_updated_at ON public.background_jobs;
CREATE TRIGGER background_jobs_updated_at
  BEFORE UPDATE ON public.background_jobs
  FOR EACH ROW EXECUTE FUNCTION public.admin_touch_updated_at();

INSERT INTO public.admin_permissions (permission_key, label, area)
VALUES
  ('jobs.read', 'Read background jobs', 'Background jobs'),
  ('jobs.create', 'Create background jobs', 'Background jobs')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.admin_group_permissions (group_id, permission_id, effect)
SELECT g.id, p.id, 'allow'::public.permission_effect
  FROM public.admin_groups AS g
 CROSS JOIN public.admin_permissions AS p
 WHERE g.name = 'Super Admins'
   AND p.permission_key IN ('jobs.read', 'jobs.create')
ON CONFLICT (group_id, permission_id) DO NOTHING;

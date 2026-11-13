import { defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway((ctx) => {
  const sharedEnv = {
    APP_ENV: "production",
    RAILPACK_PYTHON_VERSION: "3.12.8",
    DATABASE_URL: ctx.shared.DATABASE_URL,
    CELERY_BROKER_URL: ctx.shared.CELERY_BROKER_URL,
    REDIS_KEY_PREFIX: "pns:backend:",
    PNS_CELERY_TASK_TIME_LIMIT_SECONDS: "900",
    PNS_CELERY_WORKER_CONCURRENCY: "1",
    PNS_CELERY_JOB_DISPATCH_INTERVAL_SECONDS: "30",
    PNS_CELERY_JOB_CLEANUP_HOUR: "3",
    PNS_CELERY_JOB_CLEANUP_MINUTE: "15",
    PNS_BACKGROUND_JOB_RETENTION_DAYS: "30",
  };
  const beatSchedule = volume("pns-celery-beat-schedule", { sizeMB: 1024 });

  const worker = service("pns-celery-worker", {
    source: github("DEZA-CODEX/PNS", { rootDirectory: "backend" }),
    build: "pip install -r requirements.txt",
    start:
      "celery -A app.celery_app:celery_app worker --loglevel=INFO --queues=pns-default,pns-maintenance",
    replicas: 1,
    env: sharedEnv,
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
  });

  const beat = service("pns-celery-beat", {
    source: github("DEZA-CODEX/PNS", { rootDirectory: "backend" }),
    build: "pip install -r requirements.txt",
    start:
      "celery -A app.celery_app:celery_app beat --loglevel=INFO --schedule=/data/celerybeat-schedule",
    replicas: 1,
    env: sharedEnv,
    volumeMounts: {
      "/data": beatSchedule,
    },
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
  });

  return project("pns-hotel", {
    resources: [worker, beat, beatSchedule],
  });
});

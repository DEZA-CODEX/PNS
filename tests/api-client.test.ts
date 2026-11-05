import assert from "node:assert/strict";
import { after, test } from "node:test";

const originalApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const originalFetch = globalThis.fetch;
const { ApiConfigurationError, apiFetch, apiUrl } = await import("../src/lib/api-client.ts");

function setApiUrl(value?: string) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_API_BASE_URL");
  } else {
    Reflect.set(process.env, "NEXT_PUBLIC_API_BASE_URL", value);
  }
}

after(() => {
  setApiUrl(originalApiUrl);
  globalThis.fetch = originalFetch;
});

test("builds absolute local, hosted, custom-domain, and changed-backend URLs", () => {
  setApiUrl("http://localhost:8000");
  assert.equal(apiUrl("/admin/auth/login"), "http://localhost:8000/api/v1/admin/auth/login");

  setApiUrl("https://backend.vercel.app/");
  assert.equal(apiUrl("/admin/auth/login"), "https://backend.vercel.app/api/v1/admin/auth/login");

  setApiUrl("https://api.custom.example");
  assert.equal(apiUrl("/admin/auth/login"), "https://api.custom.example/api/v1/admin/auth/login");

  setApiUrl("https://changed.example/");
  assert.equal(apiUrl("/admin/auth/login"), "https://changed.example/api/v1/admin/auth/login");
});

test("normalizes trailing slashes and duplicate API prefixes", () => {
  setApiUrl("https://backend.vercel.app/");
  assert.equal(
    apiUrl("/api/v1/admin/auth/login"),
    "https://backend.vercel.app/api/v1/admin/auth/login",
  );
  assert.equal(
    apiUrl("/api/api/v1/admin/auth/login"),
    "https://backend.vercel.app/api/v1/admin/auth/login",
  );
});

test("reports missing or invalid backend configuration clearly", () => {
  setApiUrl();
  assert.throws(() => apiUrl("/admin/auth/login"), ApiConfigurationError);

  setApiUrl("backend.vercel.app");
  assert.throws(() => apiUrl("/admin/auth/login"), ApiConfigurationError);
});

test("posts login to an absolute backend URL with credentials included", async () => {
  setApiUrl("https://backend.vercel.app");
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response("{}", { status: 200 });
  };

  await apiFetch("/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(requestUrl, "https://backend.vercel.app/api/v1/admin/auth/login");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.credentials, "include");
  assert.equal(new Headers(requestInit?.headers).get("Content-Type"), "application/json");
  assert.equal(requestInit?.body, "{}");
});

test("preserves each supported HTTP method", async () => {
  setApiUrl("https://backend.vercel.app");
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  for (const method of methods) {
    let requestMethod: string | undefined;
    globalThis.fetch = async (_input, init) => {
      requestMethod = init?.method;
      return new Response("{}", { status: 200 });
    };
    await apiFetch("/admin/users", { method });
    assert.equal(requestMethod, method);
  }
});

test("lets the browser set the multipart boundary", async () => {
  setApiUrl("https://backend.vercel.app");
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response("{}", { status: 200 });
  };

  await apiFetch("/admin/room-images", {
    method: "POST",
    body: new FormData(),
    headers: { "Content-Type": "multipart/form-data" },
  });

  assert.equal(new Headers(requestInit?.headers).has("Content-Type"), false);
});

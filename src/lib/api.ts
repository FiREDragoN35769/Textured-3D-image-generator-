export async function checkedResponse(response: Response): Promise<Response> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `Request failed (HTTP ${response.status})`);
  }
  return response;
}

export async function requestJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await checkedResponse(await fetch(url, options));
  return response.json();
}

export function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

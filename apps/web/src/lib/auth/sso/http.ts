const SSO_HTTP_TIMEOUT_MS = 8_000;
const SSO_MAX_RESPONSE_BYTES = 256 * 1024;

export async function fetchSso(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(SSO_HTTP_TIMEOUT_MS) });
}

/** Read IdP responses with a hard bound even when Content-Length is absent or false. */
export async function readSsoResponseText(response: Response): Promise<string | null> {
  if (response.body === null) {
    const text = await response.text();
    return text.length <= SSO_MAX_RESPONSE_BYTES ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > SSO_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}

export async function readSsoJson(response: Response): Promise<unknown | null> {
  const text = await readSsoResponseText(response).catch(() => null);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

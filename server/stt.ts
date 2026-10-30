// server/stt.ts — the student's voice in: Speechmatics real-time speech-to-text, streamed from the
// browser's microphone straight to Speechmatics. POST /api/stt {} → { jwt, url }: a temporary key
// (ttl STT_TTL_S) minted with the account key, which never leaves the server. The browser opens
// `url?jwt=…` itself (src/agent/dictation.ts): audio never passes through the dev server.
//
// Speechmatics is billed on its own account (not the OpenAI ledger); the free plan's concurrent
// session limit is 2.
export const STT_MINT_URL = 'https://mp.speechmatics.com/v1/api_keys?type=rt';
/** The realtime endpoint nearest the student (Speechmatics routes `global` to a region). */
export const STT_WS_URL = 'wss://global.rt.speechmatics.com/v2';
/** A key only has to last until the WebSocket opens; the session then runs on. */
export const STT_TTL_S = 60;

export type SttToken = { jwt: string; url: string };

/** Mints a temporary realtime key. Throws a message safe to log (never the key). */
export async function mintSttToken(key: string, f: typeof fetch = fetch): Promise<SttToken> {
  const res = await f(STT_MINT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ ttl: STT_TTL_S }),
  });
  if (!res.ok) throw new Error(`speechmatics: key request failed (${res.status})`);
  const body = (await res.json()) as { key_value?: unknown };
  if (typeof body.key_value !== 'string' || !body.key_value) throw new Error('speechmatics: no key_value in the response');
  return { jwt: body.key_value, url: STT_WS_URL };
}

// pages/api/tts.ts          — Node‑runtime API route (Pages Router)

// 1️⃣  The OpenAI SDK needs its fetch/polyfill shim to be loaded FIRST
import 'openai/shims/node';                            // ← must precede any other openai import :contentReference[oaicite:0]{index=0}
import OpenAI from 'openai';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  /* ------------------------------------------------------------------ *
   * Query parameter:  /api/tts?q=Your+text+here
   * ------------------------------------------------------------------ */
  const text = (req.query.q as string) ?? 'Hello, streaming world!';

  /* ------------------------------------------------------------------ *
   * Call OpenAI Speech – audio is streamed with chunk‑transfer encoding
   * (The Speech API always streams; no `stream:true` flag exists.)      *
   * ------------------------------------------------------------------ */
  const openai = new OpenAI();
  const speechResponse = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'coral',
    input: text,
    response_format: 'mp3',                           // browser‑friendly
  });                                                 // streams by default :contentReference[oaicite:1]{index=1}

  /* ------------------------------------------------------------------ *
   * Pipe the Readable stream straight to the HTTP response.            *
   * This keeps memory constant and lets the client start playback
   * after the first few kilobytes arrive.                              *
   * ------------------------------------------------------------------ */
  res.setHeader('Content-Type', 'audio/mpeg');
  (speechResponse.body as unknown as NodeJS.ReadableStream).pipe(res);  // canonical Node pattern :contentReference[oaicite:2]{index=2}
}

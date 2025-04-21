// // pages/api/stt.ts  – WebSocket proxy to OpenAI Realtime STT
// import 'openai/shims/node';
// import type { NextApiRequest, NextApiResponse } from 'next';
// import { WebSocketServer, WebSocket } from 'ws';
// import type { IncomingMessage } from 'http';
// import type { Socket } from 'net';
// import http from 'http';
// import dotenv from 'dotenv';
// dotenv.config();

// export const config = { api: { bodyParser: false } };

// const OPENAI_KEY = process.env.OPENAI_API_KEY!;
// if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY');

// /* ---------------- OpenAI upstream WS ---------------- */
// const upstream = new WebSocket(
//   'wss://api.openai.com/v1/realtime?intent=transcription',
//   {
//     headers: {
//       Authorization: `Bearer ${OPENAI_KEY}`,
//       'OpenAI-Beta': 'realtime=v1',
//     },
//   },
// );

// let sessionId: string | null = null;
// upstream.on('message', (buf) => {
//   const msg = JSON.parse(buf.toString());
//   if (msg.type === 'transcription_session.created') {
//     sessionId = msg.session.id;
//     upstream.send(
//       JSON.stringify({
//         type: 'transcription_session.update',
//         session: sessionId,
//         input_audio_format: 'pcm16',
//         input_audio_transcription: { model: 'gpt-4o-transcribe', language: 'en' },
//       }),
//     );
//     return;
//   }
//   if (msg.type?.startsWith('conversation.item.input_audio_transcription')) {
//     clients.forEach((c) =>
//       c.readyState === WebSocket.OPEN && c.send(JSON.stringify(msg)),
//     );
//   }
// });

// /* ---------------- local WS server ------------------- */
// const g = globalThis as any;
// g.sttWss ??= new WebSocketServer({ noServer: true });
// const clients: Set<WebSocket> = g.clients ??= new Set();

// g.sttWss.on('connection', (client: WebSocket) => {
//   clients.add(client);
//   console.log('Frontend WS connected');

//   client.on('message', (chunk: Buffer) => {
//     if (!sessionId) return;
//     upstream.send(
//       JSON.stringify({
//         type: 'input_audio_buffer.append',
//         session: sessionId,
//         audio: chunk.toString('base64'),
//       }),
//     );
//   });

//   client.on('close', () => {
//     clients.delete(client);
//     console.log('Frontend WS closed');
//   });
// });

// /* ------------- upgrade handler ---------------------- */
// function attachUpgrade(server: http.Server) {
//   if (g.upgradeAttached) return;
//   g.upgradeAttached = true;
//   server.on('upgrade', (req: IncomingMessage, sock: Socket, head: Buffer) => {
//     if (req.url?.startsWith('/api/stt')) {
//       g.sttWss.handleUpgrade(req, sock, head, (ws) =>
//         g.sttWss.emit('connection', ws, req),
//       );
//     }
//   });
// }

// /* ------------- API route (just attaches) ------------ */
// export default function handler(_req: NextApiRequest, res: NextApiResponse) {
//   const srv = (res.socket as Socket & { server: http.Server }).server;
//   attachUpgrade(srv);
//   res.status(200).end();
// }

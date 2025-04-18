// !!! keep the shim first because this file runs in the Node runtime
import 'openai/shims/node';                        // ensures global fetch is present :contentReference[oaicite:0]{index=0}
import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { AI_CONTEXT } from '@/constants';

type Data = { chatResponse?: string; error?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>,
) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { transcript, conversation = [] } = req.body;
    if (!transcript)
      return res.status(400).json({ error: 'No transcript provided' });

    /** filter out placeholders */
    const history = conversation
      .filter(
        (c: { sender: 'user' | 'ai'; text: string }) =>
          c.text &&
          !['Processing your message...', 'AI is typing...'].includes(c.text),
      )
      .map((c: { sender: 'user' | 'ai'; text: string }) => ({
        role: c.sender === 'user' ? 'user' : 'assistant',
        content: c.text,
      }));

    /** get assistant reply */
    const { data } = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: AI_CONTEXT }, ...history],
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      },
    );                                                   /* SSE not used here */

    /** send text only – TTS happens in /api/tts */
    return res.status(200).json({
      chatResponse: data.choices[0].message.content,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
}

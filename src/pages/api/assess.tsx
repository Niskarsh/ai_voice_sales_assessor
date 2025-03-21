// pages/api/assess.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { AI_CONTEXT } from '@/constants';

export const config = {
  api: {
    bodyParser: true, // JSON payload
  },
};

interface ChatCompletionChoice {
  message: {
    role: string;
    content: string;
  };
}

interface ChatResponse {
  choices: ChatCompletionChoice[];
}

type Data = {
  chatResponse?: string;
  ttsAudio?: string; // base64-encoded audio content
  ttsFile?: string; // local path for TTS-generated audio file
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  try {
    const { transcript, conversation } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'No transcript provided' });
    }

    // Remove conversation entries where text is empty or 'Processing your message...' or 'AI is typing...
    let sanitzedConversation = [];
    if (Array.isArray(conversation)) {
      sanitzedConversation = conversation.filter(
        (conversationItem: { sender: 'user' | 'ai'; text: string }) =>
          conversationItem.text && !['Processing your message...', 'AI is typing...'].includes(conversationItem.text)
      );
    }

    // Build chat messages using conversation history (from ref payload)
    const messages = [
      { role: 'system', content: AI_CONTEXT },
      ...(sanitzedConversation.map((conversationItem: { sender: 'user' | 'ai'; text: string }) => ({
        role: conversationItem.sender === 'user' ? 'user' : 'assistant',
        content: conversationItem.text,
      }))),
      // { role: 'user', content: transcript },
    ];
    // console.log('Chat messages:', messages);
    const chatResponse = await axios.post<ChatResponse>(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    const chatText = chatResponse.data.choices[0].message.content;

    // Call TTS endpoint to generate AI response audio
    const ttsPayload = {
      input: chatText,
      model: 'tts-1',
      voice: 'nova',
      response_format: 'mp3',
      speed: 1.0,
    };

    const ttsResponse = await axios.post(
      'https://api.openai.com/v1/audio/speech',
      ttsPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        responseType: 'arraybuffer',
      }
    );
    const ttsFileName = `aiResponse-${Date.now()}.mp3`;
    const ttsFilePath = path.join(uploadDir, ttsFileName);
    fs.writeFileSync(ttsFilePath, Buffer.from(ttsResponse.data, 'binary'));
    const ttsAudioBase64 = Buffer.from(ttsResponse.data, 'binary').toString('base64');

    return res.status(200).json({
      chatResponse: chatText,
      ttsAudio: ttsAudioBase64,
      ttsFile: ttsFilePath,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
}

// pages/api/assess.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export const config = {
  api: {
    bodyParser: true, // Disable Next.js built-in parser for multipart/form-data
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
  transcript?: string;
  chatResponse?: string;
  ttsAudio?: string; // base64-encoded audio content
  candidateFile?: string; // local path for candidate audio file
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

  // Define a local upload directory
  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  try {
    // Parse the multipart form data using formidable (wrapped in a Promise)
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'No transcript provided' });
    }
    
    console.log('Request body:', req.body);
    console.log('Transcript:', transcript);

    // Step 2: Build the prompt and call the Chat Completions API
    const prompt = `You are an AI Sales Assessor. Evaluate the following sales pitch and ask a counter-question to further the conversation:\n\n${transcript}`;
    const chatResponse = await axios.post<ChatResponse>(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful and critical sales assessor.' },
          { role: 'user', content: prompt },
        ],
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
    console.log('Chat response:', chatText);

    // Step 3: Convert the chat response text to speech using the TTS endpoint
    const ttsPayload = {
      input: chatText,
      model: 'tts-1', // or 'tts-1-hd'
      voice: 'nova', // choose from available voices
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
        responseType: 'arraybuffer', // receive binary audio data
      }
    );
    // Save TTS audio to a file in the uploads folder
    const ttsFileName = `aiResponse-${Date.now()}.mp3`;
    const ttsFilePath = path.join(uploadDir, ttsFileName);
    fs.writeFileSync(ttsFilePath, Buffer.from(ttsResponse.data, 'binary'));

    // Also convert TTS audio to base64 (for immediate playback if needed)
    const ttsAudioBase64 = Buffer.from(ttsResponse.data, 'binary').toString('base64');

    // Return the full result, including file paths for later stitching
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

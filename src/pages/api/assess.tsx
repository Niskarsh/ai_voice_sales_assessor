// pages/api/assess.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';

export const config = {
  api: {
    bodyParser: false, // Disable Next.js built-in parser for multipart/form-data
  },
};

interface TranscriptionResponse {
  text: string;
}

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
    const { files } = await new Promise<{ files: { [key: string]: unknown } }>((resolve, reject) => {
      const form = new IncomingForm({
        uploadDir,      // Save files in the 'uploads' folder
        keepExtensions: true, // Keep file extensions
      });
      form.parse(req, (err, _fields, files) => {
        if (err) return reject(err);
        resolve({ files });
      });
    });

    // Access the uploaded file (assuming the field name is "file")
    const file = files['file'];
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    const fileObj = Array.isArray(file) ? file[0] : file;
    const filePath = fileObj.filepath; // formidable v2+ uses 'filepath'
    if (!filePath) {
      return res.status(400).json({ error: 'File path not found' });
    }

    // Step 1: Transcribe the audio using OpenAI's Whisper API
    const transcriptionForm = new FormData();
    transcriptionForm.append('file', fs.createReadStream(filePath));
    transcriptionForm.append('model', 'whisper-1');
    // Note: We omit the 'language' parameter to let the model auto-detect the language

    const transcriptionResponse = await axios.post<TranscriptionResponse>(
      'https://api.openai.com/v1/audio/transcriptions',
      transcriptionForm,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...transcriptionForm.getHeaders(),
        },
      }
    );
    const transcript = transcriptionResponse.data.text;
    console.log('!!!!!!!!!!!!!!!!!!!!!!Transcript:', transcript);
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
    console.log('@@@@@@@@@@@@@@@@@@@@@@@@Chat', chatText);

    // Step 3: Convert the chat response text to speech using the TTS endpoint
    const payload = {
      input: chatText,
      model: 'tts-1',
      voice: 'nova',
      response_format: 'mp3',
      speed: 1.0  // as a number
    };
    
    const ttsResponse = await axios.post(
      'https://api.openai.com/v1/audio/speech',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        responseType: 'arraybuffer', // if you want to receive binary audio data
      }
    );
    // console.log(`$$$$$$$$$$$$$$$$$$3Audio length: ${ttsResponse}`);
    // Convert binary audio data to a base64-encoded string so it can be returned as JSON
    const audioBase64 = Buffer.from(ttsResponse.data, 'binary').toString('base64');
    // console.log(`$$$$$$$$$$$$$$$$$$4Audio base64 length: ${audioBase64.length}`);

    // Return the full result
    return res.status(200).json({
      transcript,
      chatResponse: chatText,
      ttsAudio: audioBase64,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
  }
}

// pages/api/transcribe.ts
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

type Data = {
  transcript?: string;
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
  // Ensure the upload directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  try {
    // Wrap formidable parse in a Promise
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

    // Access the file; if multiple files are sent, take the first one
    const file = files['file'];
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    const fileObj = Array.isArray(file) ? file[0] : file;
    const filePath = fileObj.filepath; // formidable v2+ uses 'filepath'
    if (!filePath) {
      return res.status(400).json({ error: 'File path not found' });
    }

    // Prepare form-data for the OpenAI transcription API
    const openaiForm = new FormData();
    openaiForm.append('file', fs.createReadStream(filePath));
    openaiForm.append('model', 'whisper-1'); // required parameter
    // openaiForm.append('language', 'en');

    // Send the request using Axios
    const openaiResponse = await axios.post<TranscriptionResponse>(
      'https://api.openai.com/v1/audio/transcriptions',
      openaiForm,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...openaiForm.getHeaders(),
        },
      }
    );

    if (openaiResponse.data && openaiResponse.data.text) {
      console.log(openaiResponse.data)
      return res.status(200).json({ transcript: openaiResponse.data.text });
    } else {
      return res.status(500).json({ error: 'Transcription failed' });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
  }
}

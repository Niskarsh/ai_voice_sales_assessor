// pages/api/transcribe.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';

export const config = {
  api: {
    bodyParser: false, // for multipart data
  },
};

interface TranscriptionResponse {
  text: string;
}

type Data = {
  transcript?: string;
  candidateFile?: string;
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Save file to local 'uploads' folder
  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  try {
    const { files } = await new Promise<{ files: { [key: string]: unknown } }>((resolve, reject) => {
      const form = new IncomingForm({
        uploadDir,
        keepExtensions: true,
      });
      form.parse(req, (err, _fields, files) => {
        if (err) return reject(err);
        resolve({ files });
      });
    });

    const file = files['file'];
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    const fileObj = Array.isArray(file) ? file[0] : file;
    const candidateFilePath = fileObj.filepath;
    if (!candidateFilePath) {
      return res.status(400).json({ error: 'Candidate file path not found' });
    }

    const transcriptionForm = new FormData();
    transcriptionForm.append('file', fs.createReadStream(candidateFilePath));
    transcriptionForm.append('model', 'whisper-1'); // auto-detect language by omitting 'language'

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

    return res.status(200).json({
      transcript,
      candidateFile: candidateFilePath,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
}

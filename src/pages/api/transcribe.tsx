// pages/api/transcribe.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';

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

  // Get segment index from query (default to timestamp if not provided)
  const index = req.query.index || Date.now();
  
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
    const originalPath = fileObj.filepath;
    if (!originalPath) {
      return res.status(400).json({ error: 'Candidate file path not found' });
    }

    // Convert candidate file to MP3 if needed.
    const ext = path.extname(originalPath).toLowerCase();
    let candidateMp3Path = originalPath;
    if (ext !== '.mp3') {
      candidateMp3Path = path.join(uploadDir, `segment-${index}-candidate.mp3`);
      await new Promise<void>((resolve, reject) => {
        ffmpeg(originalPath)
          .toFormat('mp3')
          .on('end', () => {
            console.log(`Candidate conversion complete: ${candidateMp3Path}`);
            resolve();
          })
          .on('error', (err: Error) => reject(err))
          .save(candidateMp3Path);
      });
    }

    const transcriptionForm = new FormData();
    transcriptionForm.append('file', fs.createReadStream(candidateMp3Path));
    transcriptionForm.append('model', 'whisper-1');

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
      candidateFile: candidateMp3Path,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
}

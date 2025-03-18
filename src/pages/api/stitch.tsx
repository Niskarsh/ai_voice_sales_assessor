// pages/api/stitch.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: true, // expecting JSON body
  },
};

type Data = {
  stitchedAudio?: string; // base64-encoded audio
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { candidateFile, ttsFile } = req.body;
    if (!candidateFile || !ttsFile) {
      return res.status(400).json({ error: 'Missing file paths' });
    }

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
    } else {
      throw new Error('ffmpeg-static not found');
    }

    // Ensure candidate audio is in MP3 format.
    const candidateExt = path.extname(candidateFile).toLowerCase();
    let candidateMp3Path = candidateFile;
    if (candidateExt !== '.mp3') {
      candidateMp3Path = path.join(uploadDir, `candidate-${Date.now()}.mp3`);
      await new Promise<void>((resolve, reject) => {
        ffmpeg(candidateFile)
          .toFormat('mp3')
          .on('end', () => {
            console.log('Candidate conversion complete');
            resolve();
          })
          .on('error', (err: Error) => reject(err))
          .save(candidateMp3Path);
      });
    }

    // Define the output stitched file path.
    const stitchedPath = path.join(uploadDir, `stitched-${Date.now()}.mp3`);

    // Use ffmpeg's concat filter to re-encode and stitch the two audio files.
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(candidateMp3Path)
        .input(ttsFile)
        .complexFilter(['[0:a][1:a]concat=n=2:v=0:a=1[outa]'])
        .outputOptions(['-map', '[outa]', '-acodec', 'libmp3lame'])
        .on('end', () => {
          console.log('Concatenation complete');
          resolve();
        })
        .on('error', (err: Error) => {
          console.error('Error during concatenation:', err.message);
          reject(err);
        })
        .save(stitchedPath);
    });

    // Read the stitched file and encode it in base64.
    const stitchedBuffer = fs.readFileSync(stitchedPath);
    const stitchedBase64 = stitchedBuffer.toString('base64');

    // Cleanup: Optionally remove intermediate files if desired.
    // fs.unlinkSync(candidateMp3Path); // if candidateMp3Path was a conversion result
    // fs.unlinkSync(ttsFile); // if you want to remove the TTS file too

    return res.status(200).json({ stitchedAudio: stitchedBase64 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Stitching error:', errorMessage);
    return res.status(500).json({ error: errorMessage });
  }
}

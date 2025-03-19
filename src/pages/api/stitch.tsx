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
    const { candidateFiles, ttsFiles } = req.body;
    if (
      !candidateFiles ||
      !ttsFiles ||
      !Array.isArray(candidateFiles) ||
      !Array.isArray(ttsFiles)
    ) {
      return res.status(400).json({ error: 'Missing or invalid file paths' });
    }

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
    } else {
      throw new Error('ffmpeg-static not found');
    }

    // Convert all candidate files to MP3 if needed.
    const candidateMp3Files: string[] = [];
    for (const candidateFile of candidateFiles) {
      const ext = path.extname(candidateFile).toLowerCase();
      if (ext !== '.mp3') {
        const candidateMp3Path = path.join(uploadDir, `candidate-${Date.now()}.mp3`);
        await new Promise<void>((resolve, reject) => {
          ffmpeg(candidateFile)
            .toFormat('mp3')
            .on('end', () => {
              console.log(`Candidate conversion complete: ${candidateMp3Path}`);
              resolve();
            })
            .on('error', (err: Error) => reject(err))
            .save(candidateMp3Path);
        });
        candidateMp3Files.push(candidateMp3Path);
      } else {
        candidateMp3Files.push(candidateFile);
      }
    }

    // Build a concat list file for the demuxer.
    let concatListContent = '';
    // Stitch them in alternating order: candidate, then corresponding TTS.
    for (let i = 0; i < candidateMp3Files.length; i++) {
      concatListContent += `file '${candidateMp3Files[i]}'\n`;
      if (ttsFiles[i]) {
        concatListContent += `file '${ttsFiles[i]}'\n`;
      }
    }
    const concatListPath = path.join(uploadDir, `concat-${Date.now()}.txt`);
    fs.writeFileSync(concatListPath, concatListContent);

    // Define the output stitched file path.
    const stitchedPath = path.join(uploadDir, `stitched-${Date.now()}.mp3`);

    // Use ffmpeg's concat demuxer to stitch files together asynchronously.
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c:a', 'libmp3lame'])
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

    // Read and encode stitched audio.
    const stitchedBuffer = fs.readFileSync(stitchedPath);
    const stitchedBase64 = stitchedBuffer.toString('base64');

    // Cleanup: remove temporary file list.
    fs.unlinkSync(concatListPath);

    return res.status(200).json({ stitchedAudio: stitchedBase64 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
}

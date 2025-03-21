// pages/api/stitch.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const config = {
  api: {
    bodyParser: true, // expecting JSON body
  },
};

type Data = {
  stitchedAudioUrl?: string; // URL of the uploaded file
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
    const { candidateFiles, ttsFiles, name } = req.body;
    if (
      !candidateFiles ||
      !ttsFiles ||
      !name ||
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

    const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET } = process.env;
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_REGION || !AWS_S3_BUCKET) {
      return res.status(500).json({ error: 'AWS credentials not found' });
    }
    // Upload the stitched file to S3.
    const s3Client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
      useAccelerateEndpoint: true,
    });
    const fileStream = fs.createReadStream(stitchedPath);
    const s3Key = `voice_recordings/${name.trim()}-${Date.now()}.mp3`;
    const putCommand = new PutObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3Key,
      Body: fileStream,
      ContentType: 'audio/mp3',
    });

    await s3Client.send(putCommand);
    console.log(`Uploaded stitched file to S3 at key: ${s3Key}`);

    // Optionally, generate a public URL (if your bucket policy allows public read)
    const stitchedAudioUrl = `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`;

    // Build a set of files to delete (only those involved in this session).
    const filesToDelete = new Set<string>();
    // Files passed in req.body.
    candidateFiles.forEach((file: string) => filesToDelete.add(file));
    ttsFiles.forEach((file: string) => filesToDelete.add(file));
    // Files created in this function.
    candidateMp3Files.forEach((file: string) => filesToDelete.add(file));
    filesToDelete.add(concatListPath);
    filesToDelete.add(stitchedPath);

    // Delete each file if it exists.
    for (const filePath of filesToDelete) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Deleted file: ${filePath}`);
        }
      } catch (err) {
        console.error(`Failed to delete ${filePath}:`, err);
      }
    }

    return res.status(200).json({ stitchedAudioUrl });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
}

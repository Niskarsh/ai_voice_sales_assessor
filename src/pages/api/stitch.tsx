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

        // Create a temporary file list for ffmpeg concat demuxer.
        const concatListPath = path.join(uploadDir, `concat-${Date.now()}.txt`);
        const concatListContent = `file '${candidateMp3Path}'\nfile '${ttsFile}'\n`;
        fs.writeFileSync(concatListPath, concatListContent);

        // Define the output stitched file path.
        const stitchedPath = path.join(uploadDir, `stitched-${Date.now()}.mp3`);

        // Use ffmpeg to concatenate the two audio files.
        await new Promise<void>((resolve, reject) => {
            ffmpeg()
                .input(concatListPath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .outputOptions(['-c', 'copy'])
                .on('end', () => {
                    console.log('Concatenation complete');
                    resolve();
                })
                .on('error', (err: Error) => {
                    reject(err);
                })
                .save(stitchedPath);
        });

        // Read the stitched file and encode it in base64.
        const stitchedBuffer = fs.readFileSync(stitchedPath);
        const stitchedBase64 = stitchedBuffer.toString('base64');

        // Cleanup: Remove temporary file list (and optionally intermediate files)
        fs.unlinkSync(concatListPath);
        // Optionally: Remove candidateMp3Path if it was a conversion result.

        return res.status(200).json({ stitchedAudio: stitchedBase64 });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
    }
}

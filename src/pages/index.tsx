// pages/index.tsx
import { useState, useRef } from 'react';
import type { NextPage } from 'next';

const SILENCE_THRESHOLD = 10; // amplitude threshold (0-255)
const SILENCE_DURATION = 2000; // milliseconds of silence to trigger segment end

const Home: NextPage = () => {
  const [conversationActive, setConversationActive] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [chatResponse, setChatResponse] = useState<string>('');
  // Arrays to hold the file paths for each segment
  const [candidateFiles, setCandidateFiles] = useState<string[]>([]);
  const [ttsFiles, setTtsFiles] = useState<string[]>([]);
  
  // Refs for MediaRecorder and AudioContext components
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const levelIntervalRef = useRef<number | null>(null);

  // Start conversation: get user media, create audio context and start segment recording
  const startConversation = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      // Create AudioContext and Analyser for silence detection
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      setConversationActive(true);
      // Start first segment recording
      startSegmentRecording();
      // Start monitoring audio levels for silence detection
      levelIntervalRef.current = window.setInterval(monitorAudioLevel, 100);
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  };

  // Stop conversation: stop recording and clear intervals
  const stopConversation = () => {
    setConversationActive(false);
    mediaRecorderRef.current?.stop();
    if (levelIntervalRef.current) {
      clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
  };

  // Start a new recording segment
  const startSegmentRecording = () => {
    if (!audioStreamRef.current) return;
    audioChunksRef.current = [];
    const recorder = new MediaRecorder(audioStreamRef.current);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      // When the segment stops, process the recorded audio segment
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      processSegment(blob);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    console.log('Segment recording started');
  };

  // Monitor the audio level to detect silence
  const monitorAudioLevel = () => {
    if (!analyserRef.current) return;
    const bufferLength = analyserRef.current.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteTimeDomainData(dataArray);
  
    // Calculate RMS (root-mean-square) of deviations from 128
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i++) {
      const deviation = dataArray[i] - 128;
      sumSquares += deviation * deviation;
    }
    const rms = Math.sqrt(sumSquares / bufferLength);
  
    // Log the RMS value for debugging
    console.log('RMS:', rms);
  
    // Adjust this threshold based on testing (try something like 10 or 15)
    if (rms < SILENCE_THRESHOLD) {
      if (!silenceTimerRef.current) {
        silenceTimerRef.current = window.setTimeout(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            console.log('Silence detected, stopping segment');
            mediaRecorderRef.current.stop();
          }
          silenceTimerRef.current = null;
        }, SILENCE_DURATION);
      }
    } else {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    }
  };
  

  // Process a recorded segment: send it to /api/assess
  const processSegment = async (segmentBlob: Blob) => {
    const formData = new FormData();
    formData.append('file', segmentBlob, 'segment.webm');
    try {
      const res = await fetch('/api/assess', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.transcript) {
        setTranscript((prev) => prev + '\n' + data.transcript);
      }
      if (data.chatResponse) {
        setChatResponse((prev) => prev + '\n' + data.chatResponse);
      }
      if (data.candidateFile && data.ttsFile) {
        setCandidateFiles((prev) => [...prev, data.candidateFile]);
        setTtsFiles((prev) => [...prev, data.ttsFile]);
      }
      // Play AI's TTS audio response
      if (data.ttsAudio) {
        const audio = new Audio(`data:audio/mp3;base64,${data.ttsAudio}`);
        audio.play();
        // Wait for the AI response audio to finish playing before starting the next segment.
        audio.onended = () => {
          if (conversationActive) {
            startSegmentRecording();
          }
        };
      } else {
        // If no TTS audio, immediately start next segment.
        if (conversationActive) {
          startSegmentRecording();
        }
      }
    } catch (error) {
      console.error('Error processing segment:', error);
      // Start a new segment even on error.
      if (conversationActive) {
        startSegmentRecording();
      }
    }
  };

  // Stitch all segments together (candidate and AI audio)
  const completeConversation = async () => {
    try {
      const res = await fetch('/api/stitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateFiles,
          ttsFiles,
        }),
      });
      const data = await res.json();
      if (data.stitchedAudio) {
        const audio = new Audio(`data:audio/mp3;base64,${data.stitchedAudio}`);
        audio.play();
      } else {
        console.error('Stitching error:', data.error);
      }
    } catch (error) {
      console.error('Error stitching conversation:', error);
    }
  };

  return (
    <div className="container">
      <h1>AI Sales Skill Assessor</h1>
      <div className="button-container">
        {conversationActive ? (
          <button onClick={stopConversation}>Stop Conversation</button>
        ) : (
          <button onClick={startConversation}>Start Conversation</button>
        )}
        <button onClick={completeConversation} disabled={candidateFiles.length === 0 || ttsFiles.length === 0}>
          Conversation Complete
        </button>
      </div>
      <div className="content-container">
        <div className="box">
          <h2>Transcript</h2>
          <pre>{transcript}</pre>
        </div>
        <div className="box">
          <h2>AI Chat Response</h2>
          <pre>{chatResponse}</pre>
        </div>
      </div>
      <style jsx>{`
        .container {
          max-width: 700px;
          margin: 2rem auto;
          padding: 2rem;
          background: #f9f9f9;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          font-family: Arial, sans-serif;
        }
        h1 {
          text-align: center;
          margin-bottom: 1.5rem;
          color: #333;
        }
        .button-container {
          display: flex;
          justify-content: center;
          gap: 1rem;
          margin-bottom: 2rem;
        }
        button {
          padding: 0.75rem 1.25rem;
          border: none;
          border-radius: 4px;
          background-color: #0070f3;
          color: white;
          font-size: 1rem;
          cursor: pointer;
          transition: background-color 0.3s ease;
        }
        button:disabled {
          background-color: #ccc;
          cursor: not-allowed;
        }
        button:not(:disabled):hover {
          background-color: #005bb5;
        }
        .content-container {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .box {
          background: white;
          padding: 1rem;
          border: 1px solid #eaeaea;
          border-radius: 4px;
        }
        h2 {
          margin-bottom: 0.5rem;
          color: #333;
        }
        pre {
          white-space: pre-wrap;
          word-wrap: break-word;
          color: #555;
          line-height: 1.6;
        }
      `}</style>
    </div>
  );
};

export default Home;

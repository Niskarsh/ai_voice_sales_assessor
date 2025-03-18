// pages/index.tsx
import { useState, useRef } from 'react';
import type { NextPage } from 'next';

const Home: NextPage = () => {
  const [recording, setRecording] = useState<boolean>(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [chatResponse, setChatResponse] = useState<string>('');
  const [candidateFilePath, setCandidateFilePath] = useState<string>('');
  const [ttsFilePath, setTtsFilePath] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Start recording audio using getUserMedia & MediaRecorder
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  };

  // Stop recording
  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  // Send the audio blob to the backend for assessment
  const assessAudio = async () => {
    if (!audioBlob) return;
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    try {
      const res = await fetch('/api/assess', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.transcript) {
        setTranscript(data.transcript);
      } else {
        console.error('Assessment error:', data.error);
      }
      if (data.chatResponse) {
        setChatResponse(data.chatResponse);
      }
            if (data.ttsAudio) {
        // Create an audio element and set its src to the base64 audio data
        const audio = new Audio(`data:audio/mp3;base64,${data.ttsAudio}`);
        audio.play();
      }
      if (data.candidateFile && data.ttsFile) {
        setCandidateFilePath(data.candidateFile);
        setTtsFilePath(data.ttsFile);
      }
    } catch (error) {
      console.error('Error assessing audio:', error);
    }
  };

  // Stitch candidate audio and AI response audio together
  const completeConversation = async () => {
    if (!candidateFilePath || !ttsFilePath) return;
    try {
      const res = await fetch('/api/stitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateFile: candidateFilePath,
          ttsFile: ttsFilePath,
        }),
      });
      const data = await res.json();
      if (data.stitchedAudio) {
        // Play the stitched audio using an Audio element
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
        <button onClick={recording ? stopRecording : startRecording}>
          {recording ? 'Stop Recording' : 'Start Recording'}
        </button>
        <button onClick={assessAudio} disabled={!audioBlob}>
          Assess Audio
        </button>
        <button
          onClick={completeConversation}
          disabled={!candidateFilePath || !ttsFilePath}
        >
          Conversation Complete
        </button>
      </div>
      <div className="content-container">
        <div className="box">
          <h2>Transcript</h2>
          <p>{transcript}</p>
        </div>
        <div className="box">
          <h2>AI Chat Response</h2>
          <p>{chatResponse}</p>
        </div>
      </div>
      <style jsx>{`
        .container {
          max-width: 600px;
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
          justify-content: space-around;
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
        p {
          line-height: 1.6;
          color: #555;
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
};

export default Home;

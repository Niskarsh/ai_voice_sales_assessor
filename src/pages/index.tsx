// pages/index.tsx
import { useState, useRef } from 'react';
import type { NextPage } from 'next';

const Home: NextPage = () => {
  const [recording, setRecording] = useState<boolean>(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState<string>('');
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

  // Send the audio blob to the backend for transcription
  const transcribeAudio = async () => {
    if (!audioBlob) return;
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.transcript) {
        setTranscript(data.transcript);
      } else {
        console.error('Transcription error:', data.error);
      }
    } catch (error) {
      console.error('Error transcribing audio:', error);
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>AI Sales Skill Assessor</h1>
      <button onClick={recording ? stopRecording : startRecording}>
        {recording ? 'Stop Recording' : 'Start Recording'}
      </button>
      <button onClick={transcribeAudio} disabled={!audioBlob}>
        Transcribe
      </button>
      <h2>Transcript</h2>
      <p style={{ border: '1px solid #ccc', padding: '1rem' }}>{transcript}</p>
    </div>
  );
};

export default Home;

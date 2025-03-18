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
      // if (data.ttsAudio) {
      //   // Create an audio element and set its src to the base64 audio data
      //   const audio = new Audio(`data:audio/mp3;base64,${data.ttsAudio}`);
      //   audio.play();
      // }
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
    <div style={{ padding: '2rem' }}>
      <h1>AI Sales Skill Assessor</h1>
      <button onClick={recording ? stopRecording : startRecording}>
        {recording ? 'Stop Recording' : 'Start Recording'}
      </button>
      <button onClick={assessAudio} disabled={!audioBlob}>
        Assess Audio
      </button>
      <button onClick={completeConversation} disabled={!candidateFilePath || !ttsFilePath}>
        Conversation Complete
      </button>
      <h2>Transcript</h2>
      <p style={{ border: '1px solid #ccc', padding: '1rem' }}>{transcript}</p>
      <h2>AI Chat Response</h2>
      <p style={{ border: '1px solid #ccc', padding: '1rem' }}>{chatResponse}</p>
    </div>
  );
};

export default Home;

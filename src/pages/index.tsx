// pages/index.tsx
import { useState, useRef } from 'react';
import type { NextPage } from 'next';

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

const SILENCE_THRESHOLD = 10; // adjust after testing
const SILENCE_DURATION = 2000; // in ms

const Home: NextPage = () => {
  const [conversation, setConversation] = useState<Message[]>([]);
  // const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [candidateFiles, setCandidateFiles] = useState<string[]>([]);
  const [ttsFiles, setTtsFiles] = useState<string[]>([]);
  
  const recordingRef = useRef<boolean>(false);
  const conversationStartedRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const levelIntervalRef = useRef<number | null>(null);

  const startConversation = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      setConversation([]); // reset conversation
      setCandidateFiles([]);
      setTtsFiles([]);
      recordingRef.current = true;
      // setRecording(true);
      startSegmentRecording();
      levelIntervalRef.current = window.setInterval(monitorAudioLevel, 100);
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  };

  const stopConversation = () => {
    // setRecording(false);
    recordingRef.current = false;
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
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      processSegment(blob);
    };
    
    recorder.start();
    mediaRecorderRef.current = recorder;
    console.log('Segment recording started');
  };

  // Calculate RMS and detect silence
  const monitorAudioLevel = () => {
    if (!analyserRef.current) return;
    const bufferLength = analyserRef.current.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteTimeDomainData(dataArray);
    
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i++) {
      const deviation = dataArray[i] - 128;
      sumSquares += deviation * deviation;
    }
    const rms = Math.sqrt(sumSquares / bufferLength);
    // console.log('RMS:', rms);
    // console.log('Conversation started (ref):', conversationStartedRef.current);
    // console.log('Condition:', (rms > SILENCE_THRESHOLD && !conversationStartedRef.current));
    
    // If the audio level is high and we haven't started the conversation, mark it as started.
    if (rms > SILENCE_THRESHOLD && !conversationStartedRef.current) {
      conversationStartedRef.current = true;
    }
    
    // If audio level is low (silence) and the conversation is active, start a silence timer.
    if (rms < SILENCE_THRESHOLD && conversationStartedRef.current) {
      if (!silenceTimerRef.current) {
        silenceTimerRef.current = window.setTimeout(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            console.log('Silence detected, stopping segment');
            mediaRecorderRef.current.stop();
          }
          silenceTimerRef.current = null;
          // Reset conversationStarted for the next segment.
          conversationStartedRef.current = false;
        }, SILENCE_DURATION);
      }
    } else {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    }
  };

  // Process a recorded segment: send it to the backend /api/assess
  const processSegment = async (segmentBlob: Blob) => {
    const formData = new FormData();
    formData.append('file', segmentBlob, 'segment.webm');
    try {
      const res = await fetch('/api/assess', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      // Append the candidate transcript as a "user" message
      if (data.transcript) {
        setConversation((prev) => [...prev, { sender: 'user', text: data.transcript }]);
      }
      // Append the AI's response as an "ai" message
      if (data.chatResponse) {
        setConversation((prev) => [...prev, { sender: 'ai', text: data.chatResponse }]);
      }
      if (data.candidateFile && data.ttsFile) {
        setCandidateFiles((prev) => [...prev, data.candidateFile]);
        setTtsFiles((prev) => [...prev, data.ttsFile]);
      }
      // Play AI TTS audio, then start a new segment after it ends
      if (data.ttsAudio) {
        const audio = new Audio(`data:audio/mp3;base64,${data.ttsAudio}`);
        // if (recordingRef.current) startSegmentRecording();
        audio.play();
        audio.onended = () => {
          if (recordingRef.current) startSegmentRecording();
        };
      } else {
        if (recordingRef.current) startSegmentRecording();
      }
    } catch (error) {
      console.error('Error processing segment:', error);
      if (recordingRef.current) startSegmentRecording();
    }
  };

  // Stitch all segments together (this remains unchanged)
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
        {recordingRef.current ? (
          <button onClick={stopConversation}>Stop Conversation</button>
        ) : (
          <button onClick={startConversation}>Start Conversation</button>
        )}
        <button onClick={completeConversation} disabled={candidateFiles.length === 0 || ttsFiles.length === 0}>
          Conversation Complete
        </button>
      </div>
      <div className="chat-container">
        {conversation.map((msg, idx) => (
          <div key={idx} className={`chat-bubble ${msg.sender}`}>
            <span className="sender">{msg.sender === 'user' ? 'You' : 'AI'}</span>
            <p className="message">{msg.text}</p>
          </div>
        ))}
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
        .chat-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          max-height: 400px;
          overflow-y: auto;
          padding: 1rem;
          background: #fff;
          border: 1px solid #eaeaea;
          border-radius: 4px;
        }
        .chat-bubble {
          max-width: 80%;
          padding: 0.75rem 1rem;
          border-radius: 16px;
          position: relative;
          word-wrap: break-word;
        }
        .chat-bubble.user {
          background-color: #60b05b;
          align-self: flex-end;
        }
        .chat-bubble.ai {
          background-color:rgb(197, 134, 17);
          border: 1px solid #e5e5e5;
          align-self: flex-start;
        }
        .sender {
          font-weight: bold;
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.85rem;
        }
        .message {
          margin: 0;
          font-size: 1rem;
          line-height: 1.4;
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
};

export default Home;

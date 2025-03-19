// pages/index.tsx
import { useState, useRef } from 'react';
import type { NextPage } from 'next';
import axios from 'axios';

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

const SILENCE_THRESHOLD = 10; // adjust as needed
const SILENCE_DURATION = 2000; // in ms

const Home: NextPage = () => {
  const [conversation, setConversation] = useState<Message[]>([]);
  const [candidateFiles, setCandidateFiles] = useState<string[]>([]);
  const [ttsFiles, setTtsFiles] = useState<string[]>([]);

  // Track whether we are in the middle of segment recording
  const [listening, setListening] = useState(false);

  const conversationRef = useRef<Message[]>([]);
  const recordingRef = useRef<boolean>(false);
  const conversationStartedRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const levelIntervalRef = useRef<number | null>(null);

  // Start the entire conversation loop
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
      startSegmentRecording();
      levelIntervalRef.current = window.setInterval(monitorAudioLevel, 100);
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  };

  // Stop the entire conversation loop
  const stopConversation = () => {
    analyserRef.current = null;
    recordingRef.current = false;
    mediaRecorderRef.current?.stop();
    setListening(false);

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

  // Start a new segment recording
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
      setListening(false);
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      processSegment(blob);
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setListening(true);
    console.log('Segment recording started');
  };

  // Monitor audio to detect silence
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

    // If the audio level is high and conversation not started
    if (rms > SILENCE_THRESHOLD && !conversationStartedRef.current) {
      conversationStartedRef.current = true;
    }

    // If audio level is low (silence) and the conversation is active, start a silence timer
    if (rms < SILENCE_THRESHOLD && conversationStartedRef.current) {
      if (!silenceTimerRef.current) {
        silenceTimerRef.current = window.setTimeout(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            console.log('Silence detected, stopping segment');
            mediaRecorderRef.current.stop();
          }
          silenceTimerRef.current = null;
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

  // Process a recorded segment
  const processSegment = async (segmentBlob: Blob) => {
    const formData = new FormData();
    formData.append('file', segmentBlob, 'segment.webm');
    try {
      const transcribeRes = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });
      const transcribeData = await transcribeRes.json();
      // Save file references
      if (transcribeData.candidateFile) {
        setCandidateFiles((prev) => [...prev, transcribeData.candidateFile]);
      }

      // Add user transcript
      if (transcribeData.transcript) {
        setConversation((prev) => {
          conversationRef.current = [...prev, { sender: 'user', text: transcribeData.transcript }];
          return [...prev, { sender: 'user', text: transcribeData.transcript }];
        });
      }

      // const formData2 = new FormData();
      // formData2.append('transcript', transcribeData.transcript);
      // formData2.append('conversation', conversation);
      // const res = await fetch('/api/assess', {
      //   method: 'POST',
      //   body: formData2,
      // });


      const assessPayload = {
        transcript: transcribeData.transcript,
        conversation: conversationRef.current,
      };
  
      const res = await axios.post(
        '/api/assess',
        assessPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
        }
      );
      const data = await res.data;

      // Add AI response
      if (data.chatResponse) {
        setConversation((prev) => {
          conversationRef.current = [...prev, { sender: 'ai', text: data.chatResponse }];
          return [...prev, { sender: 'ai', text: data.chatResponse }];
        });
      }

      // Save file references
      if (data.ttsFile) {
        setTtsFiles((prev) => [...prev, data.ttsFile]);
      }

      // Play AI's TTS audio, then start new segment
      if (data.ttsAudio) {
        const audio = new Audio(`data:audio/mp3;base64,${data.ttsAudio}`);
        audio.play();
        audio.onended = () => {
          if (recordingRef.current) {
            startSegmentRecording();
          }
        };
      } else {
        if (recordingRef.current) {
          startSegmentRecording();
        }
      }
    } catch (error) {
      console.error('Error processing segment:', error);
      if (recordingRef.current) {
        startSegmentRecording();
      }
    }
  };

  // Stitch all segments
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
    <div className="main-container">
      <div className="left-panel">
        <h1>AI Sales Skill Assessor</h1>
        <div className="controls">
          {recordingRef.current ? (
            <button className="mic-button" onClick={stopConversation}>
              <span className="mic-icon">🎤</span> Stop
            </button>
          ) : (
            <button className="mic-button" onClick={startConversation}>
              <span className="mic-icon">🎤</span> Start
            </button>
          )}
          <button
            className="conv-complete"
            onClick={completeConversation}
            disabled={candidateFiles.length === 0 || ttsFiles.length === 0}
          >
            Conversation Complete
          </button>
        </div>
        {recordingRef.current && listening && (
          <div className="listening-indicator">
            <div className="wave"></div>
            <div className="wave"></div>
            <div className="wave"></div>
            <div className="wave"></div>
            <div className="wave"></div>
          </div>
        )}
      </div>

      <div className="right-panel">
        <div className="chat-container">
          {conversation.map((msg, idx) => (
            <div key={idx} className={`chat-bubble ${msg.sender}`}>
              <span className="sender">{msg.sender === 'user' ? 'You' : 'AI'}</span>
              <p className="message">{msg.text}</p>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .main-container {
          display: flex;
          height: 100vh;
          background-color: #111;
          color: #fff;
          font-family: Arial, sans-serif;
        }
        .left-panel {
          width: 30%;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          background-color: #1f1f1f;
          box-shadow: 2px 0 5px rgba(0,0,0,0.2);
        }
        .left-panel h1 {
          margin-bottom: 2rem;
          font-size: 1.5rem;
        }
        .controls {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 2rem;
        }
        .mic-button, .conv-complete {
          padding: 0.75rem 1.25rem;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          transition: background-color 0.3s ease;
          width: 180px;
          text-align: center;
        }
        .mic-button {
          background-color: #0070f3;
          color: #fff;
        }
        .mic-button:hover:not(:disabled) {
          background-color: #005bb5;
        }
        .conv-complete {
          background-color: #28a745;
          color: #fff;
        }
        .conv-complete:hover:not(:disabled) {
          background-color: #218838;
        }
        .mic-button:disabled, .conv-complete:disabled {
          background-color: #555;
          cursor: not-allowed;
        }
        .mic-icon {
          margin-right: 0.5rem;
        }
        .listening-indicator {
          display: flex;
          align-items: flex-end;
          height: 40px;
          margin-top: 1rem;
        }
        .wave {
          width: 4px;
          background: #0070f3;
          margin: 0 2px;
          animation: wave 1s infinite;
          border-radius: 2px;
        }
        .wave:nth-child(1) { animation-delay: 0.1s; }
        .wave:nth-child(2) { animation-delay: 0.2s; }
        .wave:nth-child(3) { animation-delay: 0.3s; }
        .wave:nth-child(4) { animation-delay: 0.4s; }
        .wave:nth-child(5) { animation-delay: 0.5s; }
        @keyframes wave {
          0% { height: 10%; }
          50% { height: 90%; }
          100% { height: 10%; }
        }
        .right-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 2rem;
        }
        .chat-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          flex: 1;
          background: #f9f9f9;
          border-radius: 8px;
          padding: 1rem;
          overflow-y: auto;
          color: #000;
        }
        .chat-bubble {
          max-width: 80%;
          padding: 0.75rem 1rem;
          border-radius: 16px;
          position: relative;
          word-wrap: break-word;
          font-size: 1rem;
        }
        .chat-bubble.user {
          background-color: #60b05b;
          align-self: flex-end;
          color: #fff;
        }
        .chat-bubble.ai {
          background-color: #c58611;
          align-self: flex-start;
          color: #fff;
        }
        .sender {
          font-weight: bold;
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.85rem;
        }
        .message {
          margin: 0;
          line-height: 1.4;
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
};

export default Home;

// pages/index.tsx
import { useState, useRef, useEffect } from 'react';
import type { NextPage } from 'next';
import axios from 'axios';

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

const SILENCE_THRESHOLD = 10; // adjust as needed
const SILENCE_DURATION = 5000; // in ms

// TypingIndicator component showing 3 animated dots, accepts a color prop
const TypingIndicator = ({ color = "#ccc" }: { color?: string }) => (
  <div className="typing-indicator">
    <span className="dot"></span>
    <span className="dot"></span>
    <span className="dot"></span>
    <style jsx>{`
      .typing-indicator {
        display: flex;
        gap: 7px;
      }
      .dot {
        width: 6px;
        height: 6px;
        background: ${color};
        border-radius: 50%;
        animation: blink 1.4s infinite both;
      }
      .dot:nth-child(1) {
        animation-delay: 0s;
      }
      .dot:nth-child(2) {
        animation-delay: 0.2s;
      }
      .dot:nth-child(3) {
        animation-delay: 0.4s;
      }
      @keyframes blink {
        0% { opacity: 0.2; }
        20% { opacity: 1; }
        100% { opacity: 0.2; }
      }
    `}</style>
  </div>
);

const Home: NextPage = () => {
  const [conversation, setConversation] = useState<Message[]>([]);
  // Use a ref to always have the latest conversation (for payload building)
  const conversationRef = useRef<Message[]>([]);
  const [candidateFiles, setCandidateFiles] = useState<string[]>([]);
  const [ttsFiles, setTtsFiles] = useState<string[]>([]);
  const [listening, setListening] = useState(false);

  const recordingRef = useRef<boolean>(false);
  const conversationStartedRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const levelIntervalRef = useRef<number | null>(null);

  // Refs to store placeholder indices
  const lastUserPlaceholderIndexRef = useRef<number | null>(null);
  const lastAiPlaceholderIndexRef = useRef<number | null>(null);

  // Ref for chat container element for auto-scroll
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll effect: scroll to bottom when conversation updates
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [conversation]);

  // Helper: update entire conversation (state & ref)
  const updateConversation = (newConversation: Message[]) => {
    setConversation(newConversation);
    conversationRef.current = newConversation;
  };

  // Helper: update a specific message by index
  const updateConversationMessage = (index: number, newText: string) => {
    if (index < 0 || index >= conversationRef.current.length) return;
    const updated = [...conversationRef.current];
    updated[index] = { ...updated[index], text: newText };
    conversationRef.current = updated;
    setConversation(updated);
  };

  // Start continuous conversation
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

      updateConversation([]); // reset conversation
      setCandidateFiles([]);
      setTtsFiles([]);
      recordingRef.current = true;
      startSegmentRecording();
      levelIntervalRef.current = window.setInterval(monitorAudioLevel, 100);
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  };

  // Stop conversation loop
  const stopConversation = () => {
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

  // Monitor audio level (RMS) to detect silence
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
    if (rms > SILENCE_THRESHOLD && !conversationStartedRef.current) {
      conversationStartedRef.current = true;
    }
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
    // Insert user placeholder before sending to transcribe endpoint
    const userPlaceholderIndex = conversationRef.current.length;
    updateConversation([
      ...conversationRef.current,
      { sender: 'user', text: 'Processing your message...' },
    ]);
    lastUserPlaceholderIndexRef.current = userPlaceholderIndex;

    const formData = new FormData();
    formData.append('file', segmentBlob, 'segment.webm');

    try {
      // Call transcribe endpoint
      const transcribeRes = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });
      const transcribeData = await transcribeRes.json();
      if (transcribeData.candidateFile) {
        setCandidateFiles((prev) => [...prev, transcribeData.candidateFile]);
      }
      // Replace user placeholder with actual transcript
      if (transcribeData.transcript && lastUserPlaceholderIndexRef.current !== null) {
        updateConversationMessage(lastUserPlaceholderIndexRef.current, transcribeData.transcript);
        lastUserPlaceholderIndexRef.current = null;
      }
      // Insert AI placeholder for chat response
      const aiPlaceholderIndex = conversationRef.current.length;
      updateConversation([
        ...conversationRef.current,
        { sender: 'ai', text: 'AI is typing...' },
      ]);
      lastAiPlaceholderIndexRef.current = aiPlaceholderIndex;

      const assessPayload = {
        transcript: transcribeData.transcript,
        conversation: conversationRef.current,
      };
      const assessRes = await axios.post('/api/assess', assessPayload, {
        headers: { 'Content-Type': 'application/json' },
      });
      const assessData = assessRes.data;
      if (assessData.chatResponse && lastAiPlaceholderIndexRef.current !== null) {
        updateConversationMessage(lastAiPlaceholderIndexRef.current, assessData.chatResponse);
        lastAiPlaceholderIndexRef.current = null;
      }
      if (assessData.ttsFile) {
        setTtsFiles((prev) => [...prev, assessData.ttsFile]);
      }
      // Play TTS audio and then start new segment when finished
      if (assessData.ttsAudio) {
        const audio = new Audio(`data:audio/mp3;base64,${assessData.ttsAudio}`);
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

  // Stitch conversation segments together
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
        <div className="chat-container" ref={chatContainerRef}>
          {conversation.map((msg, idx) => (
            <div key={idx} className={`chat-bubble ${msg.sender}`}>
              <span className="sender">
                {msg.sender === 'user' ? 'You' : 'Customer'}
              </span>
              <div className="message">
                {msg.sender === 'ai' && msg.text === 'AI is typing...' ? (
                  <TypingIndicator color="#FFA500" />
                ) : msg.sender === 'user' && msg.text === 'Processing your message...' ? (
                  <TypingIndicator color="#FFD700" />
                ) : (
                  msg.text
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <style jsx>{`
        .main-container {
          display: flex;
          height: 100vh;
          background-color: #000;
          color: #fff;
          font-family: Arial, sans-serif;
        }
        .left-panel {
          width: 30%;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          background-color: #222;
          box-shadow: 2px 0 5px rgba(255, 255, 255, 0.1);
        }
        .left-panel h1 {
          margin-bottom: 2rem;
          font-size: 1.5rem;
          color: #FFD700;
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
          background-color: #FFD700;
          color: #000;
        }
        .mic-button:hover:not(:disabled) {
          background-color: #e6c200;
        }
        .conv-complete {
          background-color: #FFA500;
          color: #000;
        }
        .conv-complete:hover:not(:disabled) {
          background-color: #e69500;
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
          background: #FFD700;
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
          background-color: #FFF;
          color: #000;
        }
        .chat-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          flex: 1;
          background: #FFF;
          border-radius: 8px;
          padding: 1rem;
          overflow-y: auto;
        }
        .chat-bubble {
          max-width: 80%;
          padding: 0.75rem 1rem;
          border-radius: 16px;
          word-wrap: break-word;
          font-size: 1rem;
        }
        .chat-bubble.user {
          background-color: #222;
          align-self: flex-end;
          color: #FFD700;
        }
        .chat-bubble.ai {
          background-color: #333;
          align-self: flex-start;
          color: #FFA500;
        }
        .chat-bubble.user .sender {
          text-align: right;
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.85rem;
        }
        .chat-bubble.ai .sender {
          text-align: left;
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.85rem;
        }
        .message {
          margin-top: 10px;
          margin-bottom: 10px;
          line-height: 1.4;
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
};

export default Home;

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
  const [name, setName] = useState<string | null>('nik');
  const [nameEntered, setNameEntered] = useState<boolean>(false);
  const [uploading,
    // setUploading,
  ] = useState(false); // New state for upload skeleton
  // Use a ref to always have the latest conversation (for payload building)
  const conversationRef = useRef<Message[]>([]);
  // const [
  //   // candidateFiles,
  //   setCandidateFiles] = useState<string[]>([]);
  // const [
  //   // ttsFiles,
  //   setTtsFiles] = useState<string[]>([]);
  const listeningRef = useRef<boolean>(false);
  const recordingRef = useRef<boolean>(false);
  const conversationStartedRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const levelIntervalRef = useRef<number | null>(null);
  const sttWsRef = useRef<WebSocket | null>(null);
  const pcmWorkletRef = useRef<AudioWorkletNode | null>(null);

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

  useEffect(() => {
    /* --------------------------------------------------------------- *
      *  ① open browser → /api/stt WebSocket                            *
      * --------------------------------------------------------------- */
    sttWsRef.current = new WebSocket('ws://localhost:4000');
    sttWsRef.current.binaryType = 'arraybuffer';
    sttWsRef.current.onclose = stopConversation;
  }, []);

  // Helper: update entire conversation (state & ref)
  const updateConversation = (newConversation: Message[]) => {
    setConversation(newConversation);
    conversationRef.current = newConversation;
  };

  // Helper: update a specific message by index
  const updateConversationMessage = (index: number, newText: string) => {
    const skippables = ['AI is typing...', 'Processing your message...'];
    if (index < 0 || index >= conversationRef.current.length) return;
    const updated = [...conversationRef.current];
    const processedText = skippables.includes(updated[index].text) ? newText: `${updated[index].text} ${newText}`;
    updated[index] = { ...updated[index], text: processedText };
    conversationRef.current = updated;
    setConversation(updated);
  };

  const playStreamingTTS = (text: string, onEnded: () => void) => {
    const audio = new Audio(`/api/tts?q=${encodeURIComponent(text)}`);
    audio.play().catch(console.error);                  // progressive MP3 :contentReference[oaicite:2]{index=2}
    audio.onended = onEnded;
  };


  // Start continuous conversation
  const startConversation = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      /* 3 — Create an AudioContext explicitly at 24 kHz */
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      // Prepare the audio stream for processing
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Create and attrach worklet processor to pass processed audio for transcription
      const workletUrl = new URL('/pcm16-worklet.js', window.location.origin).href;
      await audioContextRef.current.audioWorklet.addModule(workletUrl);
      const pcmWorklet = new AudioWorkletNode(audioContextRef.current, 'pcm16-processor');
      pcmWorkletRef.current = pcmWorklet;
      /* 5 — Connect mic → worklet and start */
      const src = audioContextRef.current.createMediaStreamSource(stream);
      src.connect(pcmWorklet);
      


      updateConversation([]); // reset conversation
      // setCandidateFiles([]);
      // setTtsFiles([]);
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
    listeningRef.current = false;
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
    sttWsRef.current?.close();
  };

  // Start a new segment recording
  const startSegmentRecording = () => {
    if (!audioStreamRef.current) return;
    if (!audioContextRef.current) return;
    if (!pcmWorkletRef.current) return;
    audioChunksRef.current = [];
    const recorder = new MediaRecorder(audioStreamRef.current);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };          // MDN﻿③
    recorder.onstop = () => {
      listeningRef.current = false;
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      processSegment(blob);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    const userPlaceholderIndex = conversationRef.current.length;
    updateConversation([
      ...conversationRef.current,
      { sender: 'user', text: 'Processing your message...' },
    ]);
    lastUserPlaceholderIndexRef.current = userPlaceholderIndex;
    pcmWorkletRef.current.port.onmessage = ({ data }: { data: Uint8Array }) => {
      // console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!', data)
      if (
        listeningRef.current &&
        conversationStartedRef.current &&
        sttWsRef.current?.readyState === WebSocket.OPEN
      ) {
        sttWsRef.current.send(data);        // raw PCM16 bytes
      }
    };

    if (sttWsRef.current) {
      sttWsRef.current.onmessage = (ev) => {
        const evt = JSON.parse(ev.data as string);
        if (evt.type?.endsWith('.delta')) console.log('Δ', evt.delta);
        if (evt.type?.endsWith('.completed')) {
          console.log('✔', evt.transcript)
          // Replace user placeholder with actual transcript
          if (lastUserPlaceholderIndexRef.current !== null && listeningRef.current) {
            updateConversationMessage(lastUserPlaceholderIndexRef.current, evt.transcript);
            // lastUserPlaceholderIndexRef.current = null;
          }
        };

      };
    } else {
      console.log('Websocket not connected')
    }
    listeningRef.current = true;
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
    // const userPlaceholderIndex = conversationRef.current.length;
    // updateConversation([
    //   ...conversationRef.current,
    //   { sender: 'user', text: 'Processing your message...' },
    // ]);
    // lastUserPlaceholderIndexRef.current = userPlaceholderIndex;

    const formData = new FormData();
    formData.append('file', segmentBlob, 'segment.webm');

    try {
      // Call transcribe endpoint
      // const transcribeRes = await fetch('/api/transcribe', {
      //   method: 'POST',
      //   body: formData,
      // });
      // const transcribeData = await transcribeRes.json();
      // if (transcribeData.candidateFile) {
      //   setCandidateFiles((prev) => [...prev, transcribeData.candidateFile]);
      // }
      // // Replace user placeholder with actual transcript
      // if (transcribeData.transcript && lastUserPlaceholderIndexRef.current !== null) {
      //   updateConversationMessage(lastUserPlaceholderIndexRef.current, transcribeData.transcript);
      //   lastUserPlaceholderIndexRef.current = null;
      // }
      // Insert AI placeholder for chat response
      const aiPlaceholderIndex = conversationRef.current.length;
      updateConversation([
        ...conversationRef.current,
        { sender: 'ai', text: 'AI is typing...' },
      ]);
      lastAiPlaceholderIndexRef.current = aiPlaceholderIndex;

      const assessPayload = {
        transcript: conversationRef.current[lastUserPlaceholderIndexRef.current!].text,
        conversation: conversationRef.current,
      };
      const assessRes = await axios.post('/api/assess', assessPayload, {
        headers: { 'Content-Type': 'application/json' },
      });
      const assessData = assessRes.data;
      if (assessData.chatResponse) {
        playStreamingTTS(assessData.chatResponse, () => {
          if (recordingRef.current) startSegmentRecording();
        });
      } else if (recordingRef.current) {
        startSegmentRecording();
      }
      if (assessData.chatResponse && lastAiPlaceholderIndexRef.current !== null) {
        updateConversationMessage(lastAiPlaceholderIndexRef.current, assessData.chatResponse);
        lastAiPlaceholderIndexRef.current = null;
      }
      // if (assessData.ttsFile) {
      //   setTtsFiles((prev) => [...prev, assessData.ttsFile]);
      // }
      // Play TTS audio and then start new segment when finished
      // if (assessData.ttsAudio) {
      //   const audio = new Audio(`data:audio/mp3;base64,${assessData.ttsAudio}`);
      //   audio.play();
      //   audio.onended = () => {
      //     if (recordingRef.current) startSegmentRecording();
      //   };
      // } else {
      //   if (recordingRef.current) startSegmentRecording();
      // }
      
    } catch (error) {
      console.error('Error processing segment:', error);
      if (recordingRef.current) startSegmentRecording();
    }
  };

  // Stitch conversation segments together
  // const completeConversation = async () => {
  //   setUploading(true);
  //   try {
  //     const res = await fetch('/api/stitch', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         candidateFiles,
  //         ttsFiles,
  //         name,
  //       }),
  //     });
  //     await res.json();
  //   } catch (error) {
  //     console.error('Error stitching conversation:', error);
  //   } finally {
  //     setUploading(false);
  //   }
  // };

  console.log('name', (name && name.length));
  return (
    <div className="main-container">
      {!nameEntered ? (
        <div className="overlay">
          <div className="modal">
            <h1 style={{ color: 'black', marginBottom: '20px' }}>Enter name</h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input
                style={{ height: '50px' }}
                type="text"
                placeholder="Enter your name"
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="mic-button"
                style={{ width: '100%', marginBottom: '20px' }}
                onClick={() => setNameEntered(true)}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="left-panel">
        <h1>{`Hello ${name}`}</h1>
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
          {/* <button
            className="conv-complete"
            onClick={completeConversation}
            disabled={candidateFiles.length === 0 || ttsFiles.length === 0 || uploading}
          >
            Conversation Complete
          </button> */}
        </div>
        {uploading && (
          <div className="upload-skeleton">Conversation uploading...</div>
        )}
        {recordingRef.current && listeningRef.current && (
          <div className="listening-indicator">
            <div className="wave"></div>
            <div className="wave"></div>
            <div className="wave"></div>
            <div className="wave"></div>
            <div className="wave"></div>
          </div>
        )}
        {/* Updated Product Info Section */}
        <div className="product-info" style={{ overflowY: 'auto' }}>
          <h2>Cold Call Script</h2>
          <h3>Customer Profile</h3>
          <p><strong>Name:</strong> Jane Smith</p>
          <p><strong>Age:</strong> 39</p>
          <p><strong>Sex:</strong> Female</p>
          <p><strong>Location:</strong> Houston, Texas</p>
          <p><strong>Marital Status:</strong> Married with 2 children (7 &amp; 9)</p>
          <p><strong>Tech Savviness:</strong> Moderate (uses Facebook, orders online, but cautious)</p>
          <p><strong>Occupation:</strong> School Administrator</p>
          <p><strong>Income:</strong> Middle class</p>
          <p><strong>Interests:</strong> Education, discipline, balanced routines</p>
          <p><strong>Personality:</strong> Warm but cautious, values trust, dislikes sales pressure</p>
          <p><strong>Concerns:</strong> Screen time impact, actual learning outcomes, usability for both kids, price</p>
          <h3>Product Details</h3>
          <p><strong>Product:</strong> EduNest – Smart Learning App for Children</p>
          <p><strong>Price:</strong> $249 /year per child</p>
          <h3>Final Objective</h3>
          <p>Get customer to share their email ID or phone number so we can send a WhatsApp link or demo of the product.</p>
          <h3>Introduction</h3>
          <p>Hello, is this Jane Smith? <em>(Wait for response)</em></p>
          <p>
            Hi Jane, my name is Ankit and I’m calling from EduNest. We help parents like you manage screen time while boosting real learning for kids aged 6 to 12. I just wanted to quickly share what we do — no pressure, you can decide if it’s useful or not. Is now a good time to talk for 2 minutes?
          </p>
          <h3>Warm-Up Question</h3>
          <p>Just to get a sense, are your kids using any online learning apps or websites right now?</p>
          <p>
            <strong>If No:</strong> That’s completely okay. Many parents are cautious — especially about screen time. That’s exactly what we focus on. EduNest helps create short, effective learning routines with strict screen-time limits and real educator support.
          </p>
          <p>
            <strong>If Yes:</strong> That’s great! If you don’t mind me asking, which one are they using, and are you happy with how it’s going? Any concerns?
          </p>
          <h3>Pitch: Why EduNest?</h3>
          <p>EduNest is designed by child psychologists and educators to improve real-world learning outcomes.</p>
          <p><strong>Key Benefits:</strong></p>
          <ul>
            <li>Covers Math, English, and Science aligned with CBSE &amp; ICSE</li>
            <li>Learning limited to 30 minutes per day with built-in screen-time control</li>
            <li>Adaptive difficulty based on each child’s performance</li>
            <li>Daily fun challenges: logic puzzles, reading, speaking, creative tasks</li>
            <li>No ads, no distractions, and no external links</li>
            <li>Monthly parent report on each child’s progress</li>
            <li>Parent dashboard to control access and view activity</li>
            <li>100% safe — no personal data sharing or third-party access</li>
          </ul>
          <h3>Common Questions &amp; Answers</h3>
          <ul>
            <li>
              <strong>Q:</strong> How much is it?<br />
              <strong>A:</strong> $249per child for the full year. No hidden charges.
            </li>
            <li>
              <strong>Q:</strong> Can both kids use the same plan?<br />
              <strong>A:</strong> No, each child gets a personalized plan. You’d need two subscriptions — but we do offer a family discount.
            </li>
            <li>
              <strong>Q:</strong> Will it increase screen time?<br />
              <strong>A:</strong> No — it’s capped at 30 minutes/day. After that, it auto locks.
            </li>
            <li>
              <strong>Q:</strong> What age is it designed for?<br />
              <strong>A:</strong> Ideal for children aged 6 to 12 — so perfect for your 7- and 9-year-olds.
            </li>
            <li>
              <strong>Q:</strong> How is this different from Outschool or similar platforms?<br />
              <strong>A:</strong> BYJU’S focuses on long video lectures. EduNest emphasizes short, structured, daily habits for real learning — without pushing sales or distractions.
            </li>
            <li>
              <strong>Q:</strong> What about data privacy?<br />
              <strong>A:</strong> 100% parent-controlled. We don’t sell, share, or use personal data. You can delete your data anytime.
            </li>
          </ul>
          <h3>Promotions / Offers</h3>
          <ul>
            <li>7-Day Free Trial — No payment or commitment required.</li>
            <li>$50 OFF if you subscribe today for both kids.</li>
            <li>Free printable activity worksheets every month to support offline learning.</li>
          </ul>
          <h3>Closing Statement</h3>
          <p>
            Parveen, I’d love to send you a quick WhatsApp or email with the full details, a short demo video, and a trial form. What would be the best phone number or email ID to send it to?
          </p>
          <p>
            <strong>If Yes:</strong> Great! I’m sending it now. Thanks for your time — I hope your kids enjoy the experience!
          </p>
          <p>
            <strong>If Unsure / No:</strong> No problem at all. Thanks for listening. If you ever want to revisit it, feel free to reach me anytime. Take care!
          </p>
          <h3>Quick Facts – Internal Reference</h3>
          <table border={1} cellPadding={5} cellSpacing={0}>
            <thead>
              <tr>
                <th>Detail</th>
                <th>Info</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Product Name</td>
                <td>EduNest Learning App</td>
              </tr>
              <tr>
                <td>Price</td>
                <td>$249 /year per child</td>
              </tr>
              <tr>
                <td>Subjects</td>
                <td>Math, English, Science (CBSE &amp; ICSE aligned)</td>
              </tr>
              <tr>
                <td>Usage Limit</td>
                <td>30 mins/day</td>
              </tr>
              <tr>
                <td>Age Group</td>
                <td>6–12 years</td>
              </tr>
              <tr>
                <td>Trial</td>
                <td>7-day free trial</td>
              </tr>
              <tr>
                <td>Data Privacy</td>
                <td>Fully secure and parent-controlled</td>
              </tr>
              <tr>
                <td>Unique Benefit</td>
                <td>Short, real learning habits + no sales pressure</td>
              </tr>
              <tr>
                <td>Offers</td>
                <td>Trial / Family Discount / Monthly Worksheets</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="right-panel">
        <div className="chat-container" ref={chatContainerRef}>
          {conversation.map((msg, idx) => (
            <div key={idx} className={`chat-bubble ${msg.sender}`}>
              <span className="sender">{msg.sender === 'user' ? 'You' : 'Customer'}</span>
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
        .overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        .modal {
          background: #fff;
          padding: 2rem;
          padding-bottom: 1rem;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          text-align: center;
          min-width: 20%;
        }
        .controls {
          display: flex;
          flex-direction: row-reverse;
          gap: 1rem;
        }
        input {
          padding: 0.5rem 1rem;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .mic-button,
        .conv-complete {
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
        .mic-button:disabled,
        .conv-complete:disabled {
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
        .main-container {
          display: flex;
          height: 100vh;
          background-color: #000;
          color: #fff;
          font-family: Arial, sans-serif;
        }
        .left-panel {
          width: 40%;
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
        .upload-skeleton {
          margin-top: 1rem;
          padding: 1rem;
          background-color: #444;
          border-radius: 4px;
          font-size: 1rem;
          text-align: center;
          width: 100%;
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
        /* Styles for the updated product info section */
        .product-info {
          margin-top: 2rem;
          width: 100%;
          background: #333;
          padding: 1rem;
          border-radius: 8px;
          font-size: 0.9rem;
          color: #fff;
        }
        .product-info h2,
        .product-info h3 {
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }
        .product-info p {
          margin: 0.3rem 0;
        }
        .product-info ul,
        .product-info dl,
        .product-info table {
          margin: 0.5rem 0;
        }
      `}</style>
    </div>
  );
};

export default Home;

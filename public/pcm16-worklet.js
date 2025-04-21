/* public/pcm16-worklet.js
   Converts incoming Float32 mono frames to Int16 and posts Uint8Array chunks
*/
class PCM16Processor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = [];
      this.FRAME_SIZE = 16000 * 0.2; // 200 ms at 24 kHz
    }
  
    process(inputs) {
      const input = inputs[0][0];           // mono channel   :contentReference[oaicite:0]{index=0}
      if (!input) return true;
  
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.buffer.push(int16 & 0xff, int16 >> 8); // little‑endian PCM16
      }
  
      if (this.buffer.length >= this.FRAME_SIZE * 2) { // 2 bytes per sample
        this.port.postMessage(new Uint8Array(this.buffer.splice(0)));
      }
      return true; // keep processor alive
    }
  }
  registerProcessor('pcm16-processor', PCM16Processor);   // :contentReference[oaicite:1]{index=1}
  
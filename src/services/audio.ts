import { pipeline, env } from '@xenova/transformers';
import { WaveFile } from 'wavefile';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Configure transformers.js to cache models locally
env.allowLocalModels = true;
env.useBrowserCache = false;
env.allowRemoteModels = false; // Prevent hanging on HuggingFace connection

class AudioService {
  private static sttPipeline: any = null;
  private static ttsPipeline: any = null;
  
  // ONNX pipelines in transformers.js (Node.js) are not thread-safe and can crash 
  // with state corruption (e.g., axis broadcasting errors) if called concurrently.
  private static ttsLock: Promise<void> = Promise.resolve();
  private static sttLock: Promise<void> = Promise.resolve();

  public static async init() {
    if (this.sttPipeline && this.ttsPipeline) return;

    console.log("Cargando modelo Whisper (STT) y SpeechT5 (TTS)... Esto puede tardar la primera vez.");
    
    // Initialize STT (Whisper Tiny)
    if (!this.sttPipeline) {
      this.sttPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    }
    
    // Initialize TTS (MMS-TTS-SPA - Native Spanish VITS)
    if (!this.ttsPipeline) {
      this.ttsPipeline = await pipeline('text-to-speech', 'Xenova/mms-tts-spa', { quantized: true });
    }
    
    console.log("✅ Modelos de Audio listos.");
  }

  /**
   * Convert any audio file (ogg, m4a, mp3, wav) to a Float32Array at 16kHz for Whisper
   */
  private static async convertAudioToFloat32Array(inputBuffer: Buffer): Promise<Float32Array> {
    const tempInput = path.join(os.tmpdir(), `input_${Date.now()}.audio`);
    const tempOutput = path.join(os.tmpdir(), `output_${Date.now()}.wav`);
    
    await fs.writeFile(tempInput, inputBuffer);

    return new Promise((resolve, reject) => {
      // Use FFmpeg to convert to 16kHz mono WAV
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', tempInput,
        '-ac', '1',          // mono
        '-ar', '16000',      // 16kHz sample rate
        '-c:a', 'pcm_s16le', // 16-bit PCM
        tempOutput
      ]);

      ffmpeg.on('close', async (code) => {
        try {
          if (code !== 0) {
            throw new Error(`FFmpeg exited with code ${code}`);
          }
          
          const wavBuffer = await fs.readFile(tempOutput);
          const wav = new WaveFile(wavBuffer);
          
          // @ts-ignore
          let rawSamples = wav.getSamples(false, Float32Array);
          // If stereo, just take the first channel
          if (Array.isArray(rawSamples)) {
            rawSamples = rawSamples[0];
          }
          const samples = rawSamples as unknown as Float32Array;
          
          // Normalize 16-bit PCM to [-1.0, 1.0] for Whisper
          const normalized = new Float32Array(samples.length);
          for (let i = 0; i < samples.length; i++) {
            normalized[i] = (samples[i] as number) / 32768.0;
          }
          
          resolve(normalized);
        } catch (err) {
          reject(err);
        } finally {
          // Cleanup temp files
          await fs.unlink(tempInput).catch(() => {});
          await fs.unlink(tempOutput).catch(() => {});
        }
      });
      
      ffmpeg.on('error', (err) => {
        reject(new Error(`Error starting FFmpeg. Asegúrate de tener FFmpeg instalado. ${err.message}`));
      });
    });
  }

  /**
   * Transcribe an audio buffer (e.g. from Telegram OGG or Expo M4A)
   */
  public static async transcribe(audioBuffer: Buffer): Promise<string> {
    await this.init();
    
    const audioData = await this.convertAudioToFloat32Array(audioBuffer);
    
    console.log("Transcribiendo audio...");
    
    // Acquire STT lock
    let releaseSttLock: () => void;
    const currentLock = this.sttLock;
    this.sttLock = new Promise<void>(resolve => { releaseSttLock = resolve; });
    await currentLock;

    try {
      const result = await this.sttPipeline(audioData, {
        language: 'spanish',
        task: 'transcribe',
      });
      return result.text;
    } finally {
      releaseSttLock!();
    }
  }

  /**
   * Generate speech audio (WAV Buffer) from text
   */
  public static async speak(text: string, format: 'ogg' | 'wav' = 'wav'): Promise<Buffer> {
    await this.init();
    
    console.log(`Generando audio TTS para: "${text.substring(0, 30)}..." en formato ${format}`);
    
    // We need a speaker embedding for SpeechT5. Xenova provides a default one online.
    const speaker_embeddings = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin';
    
    // Acquire TTS lock
    let releaseTtsLock: () => void;
    const currentLock = this.ttsLock;
    this.ttsLock = new Promise<void>(resolve => { releaseTtsLock = resolve; });
    await currentLock;
    
    let combinedAudio: Float32Array;
    let sampleRate = 16000;
    
    try {
      // We must chunk the text into smaller sentences and process them sequentially.
      const chunks = text.split(/(?<=[.!?\n])\s+/);
      const audioArrays: Float32Array[] = [];
      
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        
        // If a sentence is still too long, split by comma
        const subChunks = chunk.length > 200 ? chunk.split(/(?<=[,;])\s+/) : [chunk];
        
        for (const subChunk of subChunks) {
           if (!subChunk.trim()) continue;
           
           // Clean up text for TTS (remove emojis)
           const safeText = subChunk.substring(0, 250).replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
           
           if (!safeText) continue;
           
           // MMS-TTS doesn't require speaker_embeddings
           const out = await this.ttsPipeline(safeText);
           audioArrays.push(out.audio as Float32Array);
           sampleRate = out.sampling_rate;
        }
      }
      
      if (audioArrays.length === 0) {
        throw new Error("No TTS audio generated");
      }
      
      // Concatenate all audio arrays
      const totalLength = audioArrays.reduce((acc, arr) => acc + arr.length, 0);
      combinedAudio = new Float32Array(totalLength);
      let offset = 0;
      for (const arr of audioArrays) {
        combinedAudio.set(arr, offset);
        offset += arr.length;
      }
      
      // Peak Normalization to [-1.0, 1.0] to prevent clipping/robotic artifacts
      let maxVal = 0;
      for (let i = 0; i < combinedAudio.length; i++) {
        const val = combinedAudio[i] as number;
        if (Math.abs(val) > maxVal) maxVal = Math.abs(val);
      }
      if (maxVal > 1.0) {
        for (let i = 0; i < combinedAudio.length; i++) {
          combinedAudio[i] = (combinedAudio[i] as number) / maxVal;
        }
      }
      
    } finally {
      releaseTtsLock!();
    }
    
    const wav = new WaveFile();
    wav.fromScratch(1, sampleRate, '32f', combinedAudio);
    
    const wavBuffer = Buffer.from(wav.toBuffer());
    
    if (format === 'wav') {
      return wavBuffer;
    }
    
    // Convert to OGG Opus for Telegram compatibility
    const tempWav = path.join(os.tmpdir(), `tts_${Date.now()}.wav`);
    const tempOgg = path.join(os.tmpdir(), `tts_${Date.now()}.ogg`);
    await fs.writeFile(tempWav, wavBuffer);
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', tempWav,
        '-c:a', 'libopus',
        '-b:a', '32k', // Optimization for voice
        tempOgg
      ]);
      
      ffmpeg.on('close', async (code) => {
        try {
          if (code !== 0) throw new Error("FFmpeg TTS conversion failed");
          const oggBuffer = await fs.readFile(tempOgg);
          resolve(oggBuffer);
        } catch (e) {
          reject(e);
        } finally {
          await fs.unlink(tempWav).catch(() => {});
          await fs.unlink(tempOgg).catch(() => {});
        }
      });
      
      ffmpeg.on('error', reject);
    });
  }
}

export { AudioService };

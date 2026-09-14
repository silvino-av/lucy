import { pipeline, env } from '@xenova/transformers';
import { WaveFile } from 'wavefile';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Configure transformers.js to cache models locally
env.allowLocalModels = true;
env.useBrowserCache = false;
env.allowRemoteModels = false;

class AudioService {
  private static sttPipeline: any = null;
  private static sttLock: Promise<void> = Promise.resolve();

  public static async init() {
    if (this.sttPipeline) return;

    console.log("Cargando modelo Whisper (STT)...");
    
    // Initialize STT (Whisper Tiny)
    if (!this.sttPipeline) {
      this.sttPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    }
    
    console.log("✅ Modelo Whisper (STT) listo.");
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
    
    console.log("Transcribiendo audio con Whisper...");
    
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
   * Generate speech audio (OGG or WAV Buffer) from text using Kokoro-TTS (Docker)
   */
  public static async speak(text: string, format: 'ogg' | 'wav' = 'wav'): Promise<Buffer> {
    // Clean emojis and trim text
    const safeText = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
    if (!safeText) {
      throw new Error("No valid text provided for TTS");
    }

    const kokoroUrl = process.env.KOKORO_TTS_URL || "http://localhost:8880/v1/audio/speech";
    const voice = process.env.KOKORO_VOICE || "ef_dora";

    console.log(`🎙️ [Kokoro-TTS] Generando audio (${voice}, ${format}): "${safeText.substring(0, 45)}..."`);

    const response = await fetch(kokoroUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: safeText,
        voice: voice,
        response_format: format === 'ogg' ? 'opus' : 'wav'
      })
    });

    if (!response.ok) {
      const errorDetail = await response.text();
      console.error(`❌ [Kokoro-TTS] Error ${response.status}:`, errorDetail);
      throw new Error(`Kokoro TTS failed with status ${response.status}: ${errorDetail}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    console.log(`✅ [Kokoro-TTS] Audio generado exitosamente (${format})`);
    return Buffer.from(arrayBuffer);
  }
}

export { AudioService };

/**
 * Speechmatics Real-time WebSocket API client
 *
 * Connects to Speechmatics SaaS via WebSocket for real-time
 * Arabic speech-to-text transcription with word-level timestamps.
 *
 * Docs: https://docs.speechmatics.com/api-ref/
 */

const WebSocket = require('ws');
const fs = require('fs');

// Speechmatics real-time endpoint for Arabic
const SM_WS_URL = 'wss://eu2.rt.speechmatics.com/v2/ar';

/**
 * Transcribe audio file using Speechmatics real-time WebSocket API
 * @param {string} audioPath - Path to compressed audio file (WAV, 16kHz, mono)
 * @param {string} apiKey - Speechmatics API key
 * @returns {Promise<{segments: Array, words: Array, fullText: string, duration: number}>}
 */
function transcribeAudio(audioPath, apiKey) {
  return new Promise((resolve, reject) => {
    console.log(`[Speechmatics] Starting transcription for: ${audioPath}`);

    // Read audio file
    const audioBuffer = fs.readFileSync(audioPath);
    const audioStats = fs.statSync(audioPath);
    const audioDurationMs = estimateWavDuration(audioBuffer);
    console.log(`[Speechmatics] Audio size: ${(audioStats.size / 1024).toFixed(1)}KB, estimated duration: ${(audioDurationMs / 1000).toFixed(1)}s`);

    // Connect WebSocket with auth header
    const ws = new WebSocket(SM_WS_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    const results = {
      segments: [],       // Sentence-level segments
      words: [],          // Individual words
      fullText: '',       // Full concatenated text
      confidence: 0,
      duration: 0
    };

    let isConnected = false;
    let isComplete = false;
    const timeout = Math.max(audioDurationMs * 2 + 30000, 60000); // At least 60s

    // Timeout safeguard
    const timeoutId = setTimeout(() => {
      if (!isComplete) {
        ws.close();
        reject(new Error('Speechmatics transcription timed out'));
      }
    }, timeout);

    ws.on('open', () => {
      console.log('[Speechmatics] WebSocket connected, sending StartRecognition...');
      isConnected = true;

      // Send StartRecognition configuration
      const startMsg = {
        message: 'StartRecognition',
        audio_format: {
          type: 'file',
          encoding: 'pcm_s16le',  // WAV PCM 16-bit signed little-endian
          sample_rate: 16000
        },
        transcription_config: {
          language: 'ar',
          enable_partials: true,
          max_delay: 2,
          operating_point: 'standard',
          diarization: 'none',
          output_config: {
            encoding: 'utf8'
          }
        }
      };

      ws.send(JSON.stringify(startMsg));

      // Convert WAV to raw PCM and send in chunks
      // WAV header is typically 44 bytes; rest is raw PCM data
      const pcmData = stripWavHeader(audioBuffer);
      const CHUNK_SIZE = 8192; // 8KB chunks

      console.log(`[Speechmatics] Sending ${pcmData.length} bytes of audio data...`);
      let offset = 0;
      const sendInterval = setInterval(() => {
        if (offset >= pcmData.length) {
          clearInterval(sendInterval);
          // Send EndOfStream
          console.log('[Speechmatics] Audio sent, sending EndOfStream...');
          ws.send(JSON.stringify({ message: 'EndOfStream' }));
          return;
        }

        const end = Math.min(offset + CHUNK_SIZE, pcmData.length);
        const chunk = pcmData.subarray(offset, end);
        ws.send(chunk);
        offset = end;

        // Log progress every 10%
        const pct = Math.round((offset / pcmData.length) * 100);
        if (pct % 10 === 0) {
          console.log(`[Speechmatics] Sent ${pct}%`);
        }
      }, 50); // Send chunks every 50ms for smooth streaming
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.message) {
          case 'AudioAdded':
            // Audio received by server — ignore
            break;

          case 'AddPartialTranscript':
            // Partial (in-progress) transcript
            // We collect these but only final results matter
            break;

          case 'AddTranscript':
            // Final transcript for a segment
            if (msg.results && msg.results.length > 0) {
              for (const result of msg.results) {
                if (result.alternatives && result.alternatives.length > 0) {
                  const alt = result.alternatives[0];

                  const segment = {
                    text: alt.content || '',
                    start: msToInt(result.start_time * 1000),
                    end: msToInt(result.end_time * 1000),
                    confidence: parseFloat((alt.confidence || 0).toFixed(4)),
                    is_eos: result.is_eos || false
                  };

                  // Extract words with timestamps
                  if (alt.words && alt.words.length > 0) {
                    segment.words = alt.words.map(w => ({
                      text: w.content || '',
                      start: msToInt(w.start_time * 1000),
                      end: msToInt(w.end_time * 1000),
                      confidence: parseFloat((w.confidence || 0).toFixed(4))
                    }));
                  }

                  results.segments.push(segment);
                }
              }
            }
            break;

          case 'EndOfTranscript':
            console.log('[Speechmatics] Transcription complete');

            // Compile final results
            results.fullText = results.segments
              .map(s => s.text)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();

            // Average confidence
            const confidences = results.segments.map(s => s.confidence);
            results.confidence = confidences.length > 0
              ? parseFloat((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(4))
              : 0;

            // Duration from last segment
            results.duration = results.segments.length > 0
              ? results.segments[results.segments.length - 1].end
              : 0;

            isComplete = true;
            clearTimeout(timeoutId);
            ws.close();
            break;

          case 'Error':
            console.error('[Speechmatics] API Error:', msg);
            clearTimeout(timeoutId);
            ws.close();
            reject(new Error(`Speechmatics error: ${msg.reason || JSON.stringify(msg)}`));
            break;

          default:
            // Ignore other messages
            break;
        }
      } catch (err) {
        console.error('[Speechmatics] Message parse error:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error('[Speechmatics] WebSocket error:', err.message);
      clearTimeout(timeoutId);
      reject(new Error(`Speechmatics WebSocket error: ${err.message}`));
    });

    ws.on('close', (code, reason) => {
      console.log(`[Speechmatics] WebSocket closed: code=${code}, reason=${reason}`);
      if (!isComplete) {
        clearTimeout(timeoutId);
        reject(new Error(`WebSocket closed prematurely (code=${code}): ${reason}`));
      } else {
        resolve(results);
      }
    });
  });
}

/**
 * Strip WAV header to get raw PCM data
 * Standard WAV header is 44 bytes, but can vary
 * @param {Buffer} wavBuffer
 * @returns {Buffer} Raw PCM data
 */
function stripWavHeader(wavBuffer) {
  // Find "data" chunk in WAV file
  const dataIndex = wavBuffer.indexOf('data', 36); // Start searching after fmt chunk
  if (dataIndex === -1) {
    // Fallback: assume standard 44-byte header
    return wavBuffer.subarray(44);
  }
  // dataIndex + 4 ("data") + 4 (chunk size) = start of raw PCM
  return wavBuffer.subarray(dataIndex + 8);
}

/**
 * Estimate WAV duration in milliseconds from header
 * @param {Buffer} wavBuffer
 * @returns {number} Duration in ms
 */
function estimateWavDuration(wavBuffer) {
  try {
    // Read sample rate (bytes 24-27, little-endian)
    const sampleRate = wavBuffer.readUInt32LE(24);
    // Read data size (find "data" chunk)
    const dataIndex = wavBuffer.indexOf('data', 36);
    if (dataIndex === -1) return 0;
    const dataSize = wavBuffer.readUInt32LE(dataIndex + 4);
    // Duration = dataSize / (sampleRate * channels * bitsPerSample/8)
    const channels = wavBuffer.readUInt16LE(22);
    const bitsPerSample = wavBuffer.readUInt16LE(34);
    const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
    return Math.round((dataSize / bytesPerSecond) * 1000);
  } catch {
    return 0;
  }
}

/**
 * Safe millisecond conversion
 * @param {number} val
 * @returns {number}
 */
function msToInt(val) {
  return Math.round(val) || 0;
}

module.exports = { transcribeAudio };

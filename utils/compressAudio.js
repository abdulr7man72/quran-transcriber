/**
 * Audio compression using FFmpeg
 *
 * Converts any audio to:
 * - Mono channel
 * - 16kHz sample rate
 * - Low bitrate (~32kbps)
 * - Optimized for Speechmatics API
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Compress audio file for Speechmatics API
 * @param {string} inputPath - Path to input audio file
 * @param {string} outputDir - Output directory for compressed file
 * @returns {Promise<{outputPath: string, originalSize: number, compressedSize: number}>}
 */
function compressAudio(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const inputFileName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${inputFileName}_compressed.wav`);

    const originalSize = fs.statSync(inputPath).size;

    ffmpeg(inputPath)
      // Mono channel
      .audioChannels(1)
      // 16kHz sample rate (required by Speechmatics for best results)
      .audioFrequency(16000)
      // Low bitrate for smaller file size
      .audioBitrate('32k')
      // WAV format (Speechmatics works best with WAV)
      .format('wav')
      .on('start', (cmd) => {
        console.log(`[FFmpeg] Starting compression: ${cmd}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`[FFmpeg] Compression: ${progress.percent.toFixed(1)}%`);
        }
      })
      .on('end', () => {
        const compressedSize = fs.statSync(outputPath).size;
        const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);
        console.log(
          `[FFmpeg] Compressed: ${(originalSize / 1024).toFixed(1)}KB → ` +
          `${(compressedSize / 1024).toFixed(1)}KB (${savings}% smaller)`
        );
        resolve({ outputPath, originalSize, compressedSize });
      })
      .on('error', (err, stdout, stderr) => {
        console.error('[FFmpeg] Error:', err.message);
        console.error('[FFmpeg] stderr:', stderr);
        reject(new Error(`Audio compression failed: ${err.message}\n${stderr}`));
      })
      .save(outputPath);
  });
}

module.exports = { compressAudio };

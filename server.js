/**
 * Quran Transcriber - Main Server
 *
 * Express server for uploading Quran recitations,
 * transcribing them via Speechmatics API, and matching
 * against the original Quran text.
 */

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { compressAudio } = require('./utils/compressAudio');
const { transcribeAudio } = require('./utils/speechmatics');
const { matchSegmentsWithQuran } = require('./utils/compare');

const app = express();
const PORT = process.env.PORT || 3000;

// Load Quran data
let quranData = [];
try {
  quranData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'quran.json'), 'utf8'));
  console.log(`[Server] Loaded Quran data: ${quranData.length} surahs`);
} catch (err) {
  console.error('[Server] WARNING: quran.json not found or invalid — matching disabled');
  console.error(err.message);
}

// ──────────────────────────────────────
// Middleware
// ──────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
['uploads', 'compressed'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Multer storage for audio uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.wav';
    cb(null, `upload_${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp3|wav|ogg|flac|m4a|aac|wma|opus|webm)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported audio format. Use MP3, WAV, OGG, FLAC, M4A, AAC, or OPUS.'));
    }
  }
});

// ──────────────────────────────────────
// Routes
// ──────────────────────────────────────

/**
 * POST /api/upload
 * Upload audio file + compress it
 */
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log(`[Upload] Received: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);

    // Compress audio
    const compressed = await compressAudio(
      req.file.path,
      path.join(__dirname, 'compressed')
    );

    // Get audio duration using ffprobe
    const duration = await getAudioDuration(compressed.outputPath);

    res.json({
      success: true,
      originalName: req.file.originalname,
      originalSize: req.file.size,
      originalPath: `/uploads/${path.basename(req.file.path)}`,
      compressedSize: compressed.compressedSize,
      compressedPath: `/compressed/${path.basename(compressed.outputPath)}`,
      compressedFullPath: compressed.outputPath,
      duration: duration // in seconds
    });
  } catch (err) {
    console.error('[Upload] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/process
 * Transcribe audio with Speechmatics + match against Quran
 */
app.post('/api/process', async (req, res) => {
  try {
    const { compressedPath } = req.body;

    if (!compressedPath) {
      return res.status(400).json({ error: 'compressedPath is required' });
    }

    const fullPath = path.join(__dirname, compressedPath.replace(/^\//, ''));
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: `File not found: ${fullPath}` });
    }

    const apiKey = process.env.SPEECHMATICS_API_KEY;
    if (!apiKey || apiKey === 'YOUR_SPEECHMATICS_API_KEY') {
      return res.status(500).json({ error: 'Speechmatics API key not configured. Set SPEECHMATICS_API_KEY in .env' });
    }

    console.log(`[Process] Starting transcription for: ${fullPath}`);

    // Transcribe
    const transcription = await transcribeAudio(fullPath, apiKey);

    console.log(`[Process] Got ${transcription.segments.length} segments`);

    // Match against Quran
    let matchedSegments = transcription.segments;
    if (quranData.length > 0) {
      matchedSegments = matchSegmentsWithQuran(transcription.segments, quranData);
      console.log(`[Process] Matched ${matchedSegments.length} segments against Quran`);
    }

    res.json({
      success: true,
      fullText: transcription.fullText,
      confidence: transcription.confidence,
      duration: transcription.duration,
      segmentCount: transcription.segments.length,
      segments: matchedSegments
    });
  } catch (err) {
    console.error('[Process] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/export/:format
 * Export transcription results as JSON, SRT, or VTT
 */
app.get('/api/export/:format', (req, res) => {
  // Results are stored in memory — in production use a database
  res.status(400).json({ error: 'Use POST /api/export with segments data' });
});

/**
 * POST /api/export
 * Export results in requested format
 */
app.post('/api/export', (req, res) => {
  try {
    const { segments, format } = req.body;

    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: 'segments array is required' });
    }

    switch (format) {
      case 'json':
        return res.json({
          export: {
            format: 'json',
            generated: new Date().toISOString(),
            segments
          }
        });

      case 'srt':
        return res.type('text/plain').send(generateSRT(segments));

      case 'vtt':
        return res.type('text/plain').send(generateVTT(segments));

      default:
        return res.status(400).json({ error: `Unknown format: ${format}. Use json, srt, or vtt` });
    }
  } catch (err) {
    console.error('[Export] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/download/:type/:filename
 * Download generated files (transcripts, exports)
 */
app.get('/api/download/:type/:filename', (req, res) => {
  const { type, filename } = req.params;
  const dirMap = { uploads: 'uploads', compressed: 'compressed' };

  if (!dirMap[type]) {
    return res.status(400).json({ error: 'Invalid type. Use uploads or compressed' });
  }

  const filePath = path.join(__dirname, dirMap[type], filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath);
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    quranLoaded: quranData.length > 0,
    surahCount: quranData.length,
    apiKeyConfigured: !!(process.env.SPEECHMATICS_API_KEY && process.env.SPEECHMATICS_API_KEY.length > 10)
  });
});

// ──────────────────────────────────────
// Helper functions
// ──────────────────────────────────────

/**
 * Get audio duration using ffprobe
 */
function getAudioDuration(filePath) {
  const { execSync } = require('child_process');
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Format milliseconds to SRT/VTT timestamp (HH:MM:SS,mmm)
 */
function formatTimestamp(ms) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/**
 * Format milliseconds to VTT timestamp (HH:MM:SS.mmm)
 */
function formatTimestampVTT(ms) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Generate SRT subtitle content
 */
function generateSRT(segments) {
  return segments.map((seg, i) => {
    const start = formatTimestamp(seg.start);
    const end = formatTimestamp(seg.end);
    const text = seg.match && seg.match.verse
      ? `${seg.match.verse.text}\n${seg.text}`
      : seg.text;
    return `${i + 1}\n${start} --> ${end}\n${text}\n`;
  }).join('\n');
}

/**
 * Generate WebVTT subtitle content
 */
function generateVTT(segments) {
  const lines = ['WEBVTT - Quran Transcription', ''];
  segments.forEach((seg, i) => {
    const start = formatTimestampVTT(seg.start);
    const end = formatTimestampVTT(seg.end);
    const text = seg.match && seg.match.verse
      ? `${seg.match.verse.text}\n${seg.text}`
      : seg.text;
    lines.push(`${i + 1}`);
    lines.push(`${start} --> ${end}`);
    lines.push(text);
    lines.push('');
  });
  return lines.join('\n');
}

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/compressed', express.static(path.join(__dirname, 'compressed')));

// ──────────────────────────────────────
// Start server
// ──────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  🕌 Quran Transcriber Server`);
  console.log(`  ─────────────────────────────`);
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Quran:   ${quranData.length} surahs loaded`);
  console.log(`  API Key: ${process.env.SPEECHMATICS_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  console.log();
});

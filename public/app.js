/**
 * Quran Transcriber — Frontend Application
 *
 * Handles:
 * - Drag & drop audio upload
 * - Progress tracking during compression/transcription
 * - Quran-text matching display with timeline
 * - Audio sync (click segment → jump to time)
 * - Export (JSON, SRT, VTT)
 */

// ──────────────────────────────────────
// State
// ──────────────────────────────────────

const state = {
  file: null,
  uploadResult: null,
  results: null,       // { fullText, segments, confidence, duration }
  currentSegment: -1,  // Currently playing segment index
};

// ──────────────────────────────────────
// DOM References
// ──────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  dropZone: $('#drop-zone'),
  fileInput: $('#file-input'),
  fileInfo: $('#file-info'),
  fileName: $('#file-name'),
  fileMeta: $('#file-meta'),
  audioPlayer: $('#audio-player'),
  btnProcess: $('#btn-process'),
  btnProcessText: $('#btn-process-text'),
  btnProcessSpinner: $('#btn-process-spinner'),
  progressContainer: $('#progress-container'),
  progressBar: $('#progress-bar'),
  progressLabel: $('#progress-label'),
  progressPct: $('#progress-pct'),
  resultsSection: $('#results-section'),
  fullTextPreview: $('#full-text-preview'),
  statSegments: $('#stat-segments'),
  statConfidence: $('#stat-confidence'),
  statDuration: $('#stat-duration'),
  segmentsContainer: $('#segments-container'),
  stickyPlayer: $('#sticky-player'),
  audioSticky: $('#audio-player-sticky'),
};

// ──────────────────────────────────────
// Initialization
// ──────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupDragDrop();
  checkHealth();
});

// ──────────────────────────────────────
// Drag & Drop
// ──────────────────────────────────────

function setupDragDrop() {
  const dz = dom.dropZone;

  dz.addEventListener('click', () => dom.fileInput.click());

  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('active');
  });

  dz.addEventListener('dragleave', () => {
    dz.classList.remove('active');
  });

  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('active');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });

  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
  });
}

// ──────────────────────────────────────
// File Handling
// ──────────────────────────────────────

function handleFile(file) {
  // Validate
  const validTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac',
                      'audio/mp4', 'audio/aac', 'audio/x-ms-wma', 'audio/webm',
                      'audio/x-m4a', 'audio/opus', 'audio/vnd.wave'];
  const validExts = /\.(mp3|wav|ogg|flac|m4a|aac|wma|opus|webm)$/i;

  if (!validExts.test(file.name) && !validTypes.includes(file.type)) {
    showToast('❌ صيغة غير مدعومة. استخدم MP3, WAV, OGG, FLAC, M4A, AAC, OPUS', 'error');
    return;
  }

  if (file.size > 500 * 1024 * 1024) {
    showToast('❌ حجم الملف كبير جداً. الحد الأقصى 500MB', 'error');
    return;
  }

  state.file = file;
  state.uploadResult = null;
  state.results = null;
  state.currentSegment = -1;

  // Show file info
  dom.fileName.textContent = file.name;
  dom.fileMeta.textContent = `${formatSize(file.size)}`;
  dom.fileInfo.classList.remove('hidden');

  // Create audio URL
  const url = URL.createObjectURL(file);
  dom.audioPlayer.src = url;
  dom.audioPlayer.load();

  // Reset UI
  dom.progressContainer.classList.add('hidden');
  dom.resultsSection.classList.add('hidden');
  dom.segmentsContainer.innerHTML = '';
  dom.btnProcess.disabled = false;
  dom.btnProcessText.textContent = '⚡ بدء المعالجة';
  dom.btnProcessSpinner.classList.add('hidden');

  showToast('✅ تم تحميل الملف بنجاح', 'success');
}

function resetUpload() {
  state.file = null;
  state.uploadResult = null;
  state.results = null;

  dom.fileInfo.classList.add('hidden');
  dom.progressContainer.classList.add('hidden');
  dom.resultsSection.classList.add('hidden');
  dom.segmentsContainer.innerHTML = '';
  dom.audioPlayer.src = '';
  dom.fileInput.value = '';
}

// ──────────────────────────────────────
// Processing Pipeline
// ──────────────────────────────────────

async function startProcessing() {
  if (!state.file) {
    showToast('⚠️ الرجاء اختيار ملف صوتي أولاً', 'warning');
    return;
  }

  dom.btnProcess.disabled = true;
  dom.btnProcessText.textContent = 'جاري المعالجة...';
  dom.btnProcessSpinner.classList.remove('hidden');

  try {
    // Step 1: Upload & Compress
    setProgress('جاري الضغط...', 10);
    const uploadResult = await uploadFile(state.file, (pct) => {
      setProgress('جاري الرفع والضغط...', 10 + pct * 0.3);
    });

    state.uploadResult = uploadResult;
    setProgress('اكتمل الضغط', 40);

    // Update audio player with compressed file
    dom.audioPlayer.src = uploadResult.compressedPath;
    dom.audioSticky.src = uploadResult.compressedPath;
    dom.fileMeta.textContent = `${formatSize(uploadResult.compressedSize)} • ${formatDuration(uploadResult.duration)}`;

    // Step 2: Transcribe with Speechmatics
    setProgress('جاري تحويل الصوت إلى نص...', 50);
    const results = await processAudio(uploadResult.compressedFullPath);
    state.results = results;
    setProgress('اكتمل التحويل', 90);

    // Step 3: Render results
    renderResults(results);
    setProgress('اكتملت المعالجة', 100);

    // Show sticky player
    dom.stickyPlayer.classList.remove('hidden');

    setTimeout(() => {
      dom.progressContainer.classList.add('hidden');
      dom.btnProcessText.textContent = '🔄 إعادة المعالجة';
      dom.btnProcess.disabled = false;
      dom.btnProcessSpinner.classList.add('hidden');
    }, 1500);

    showToast(`✅ تمت المعالجة — ${results.segmentCount} مقطع`, 'success');
  } catch (err) {
    console.error('Processing error:', err);
    showToast(`❌ فشلت المعالجة: ${err.message}`, 'error');
    dom.btnProcess.disabled = false;
    dom.btnProcessText.textContent = '⚡ بدء المعالجة';
    dom.btnProcessSpinner.classList.add('hidden');
    dom.progressContainer.classList.add('hidden');
  }
}

// ──────────────────────────────────────
// API Calls
// ──────────────────────────────────────

async function uploadFile(file, onProgress) {
  const formData = new FormData();
  formData.append('audio', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('POST', '/api/upload');
    xhr.send(formData);
  });
}

async function processAudio(compressedPath) {
  const resp = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compressedPath }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Processing failed: HTTP ${resp.status}`);
  }

  return resp.json();
}

async function checkHealth() {
  try {
    const resp = await fetch('/api/health');
    const data = await resp.json();
    console.log('Server health:', data);
  } catch (err) {
    console.warn('Server health check failed:', err.message);
  }
}

// ──────────────────────────────────────
// Results Rendering
// ──────────────────────────────────────

function renderResults(results) {
  dom.resultsSection.classList.remove('hidden');
  dom.fullTextPreview.textContent = results.fullText || '';
  dom.statSegments.textContent = results.segmentCount || results.segments.length;
  dom.statConfidence.textContent = `${((results.confidence || 0) * 100).toFixed(1)}%`;
  dom.statDuration.textContent = formatDuration((results.duration || 0) / 1000);

  renderSegments(results.segments);
  setupAudioSync();
}

function renderSegments(segments) {
  dom.segmentsContainer.innerHTML = '';

  if (!segments || segments.length === 0) {
    dom.segmentsContainer.innerHTML = `
      <div class="text-center text-gray-500 py-8">لم يتم العثور على مقاطع</div>`;
    return;
  }

  segments.forEach((seg, i) => {
    const card = createSegmentCard(seg, i);
    dom.segmentsContainer.appendChild(card);
  });
}

function createSegmentCard(seg, index) {
  const card = document.createElement('div');
  card.className = `segment-card bg-gray-900 rounded-xl p-4 border border-gray-800 ${getStatusClass(seg.status)}`;
  card.setAttribute('data-index', index);
  card.setAttribute('data-start', seg.start);
  card.setAttribute('data-end', seg.end);

  // Timestamp
  const timestamp = `
    <div class="flex items-center gap-2 text-gray-400 text-xs latin mb-3">
      <span class="bg-gray-800 px-2 py-1 rounded">${formatTimecode(seg.start)}</span>
      <span>→</span>
      <span class="bg-gray-800 px-2 py-1 rounded">${formatTimecode(seg.end)}</span>
      <span class="text-gray-600">(${seg.end - seg.start}ms)</span>
    </div>`;

  // Main content
  let content = '';

  if (seg.match && seg.match.text && seg.match.similarity > 0) {
    // Has Quran match
    const statusBadge = getStatusBadge(seg.status, seg.match.similarity);
    const quranVerse = seg.match.verse ? seg.match.verse.text : seg.match.text;
    const surahInfo = seg.match.surah
      ? `<span class="text-emerald-500 text-xs">${seg.match.surah.name} (${seg.match.surah.id})</span>`
      : '';

    content = `
      <div class="flex items-start justify-between mb-2">
        <div>${surahInfo}</div>
        ${statusBadge}
      </div>
      <div class="quran-text text-white mb-2">${quranVerse}</div>
      <div class="text-gray-400 text-sm border-t border-gray-800 pt-2">
        <span class="text-gray-500 text-xs latin">AI:</span> ${seg.text}
      </div>
      <div class="flex gap-4 mt-2 text-xs latin">
        <span class="text-emerald-400">Match: ${seg.match.similarity}%</span>
        <span class="text-gray-500">Diff: ${seg.match.distance} chars</span>
        <span class="text-gray-500">Conf: ${(seg.confidence * 100).toFixed(1)}%</span>
      </div>`;
  } else {
    // No Quran match
    content = `
      <div class="text-gray-400 text-sm mb-2">
        <span class="text-gray-500 text-xs latin">AI Output:</span> ${seg.text}
      </div>
      <div class="text-xs latin">
        <span class="text-gray-500">Conf: ${(seg.confidence * 100).toFixed(1)}%</span>
        ${seg.match && seg.match.similarity > 0
          ? `<span class="text-gray-500 ml-3">Match: ${seg.match.similarity}%</span>`
          : '<span class="text-yellow-500 ml-3">⚠ لا يوجد تطابق قرآني</span>'}
      </div>`;
  }

  // Words detail (expandable)
  if (seg.words && seg.words.length > 0) {
    content += `
      <details class="mt-2 text-xs">
        <summary class="text-gray-500 cursor-pointer latin">🔍 Words (${seg.words.length})</summary>
        <div class="mt-2 flex flex-wrap gap-1">
          ${seg.words.map(w => `
            <span class="bg-gray-800 px-2 py-1 rounded text-gray-300" title="Conf: ${(w.confidence*100).toFixed(0)}%">
              ${w.text} <span class="text-gray-600 latin">${formatTimecode(w.start)}</span>
            </span>
          `).join('')}
        </div>
      </details>`;
  }

  card.innerHTML = timestamp + content;

  // Click to jump to time
  card.addEventListener('click', () => jumpToTime(seg.start, index));

  return card;
}

// ──────────────────────────────────────
// Audio Sync
// ──────────────────────────────────────

function setupAudioSync() {
  const player = dom.audioPlayer;

  player.addEventListener('timeupdate', () => {
    if (!state.results || !state.results.segments) return;

    const currentMs = player.currentTime * 1000;

    // Find current segment
    const segs = state.results.segments;
    let found = -1;
    for (let i = 0; i < segs.length; i++) {
      if (currentMs >= segs[i].start && currentMs <= segs[i].end) {
        found = i;
        break;
      }
    }

    if (found !== state.currentSegment) {
      // Remove previous highlight
      $$('.segment-card.playing').forEach(el => el.classList.remove('playing'));

      // Highlight new
      if (found >= 0) {
        const card = $(`.segment-card[data-index="${found}"]`);
        if (card) {
          card.classList.add('playing');
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      state.currentSegment = found;
    }
  });
}

function jumpToTime(ms, index) {
  const player = dom.audioPlayer;
  player.currentTime = ms / 1000;
  player.play().catch(() => {});

  // Highlight
  $$('.segment-card.playing').forEach(el => el.classList.remove('playing'));
  const card = $(`.segment-card[data-index="${index}"]`);
  if (card) card.classList.add('playing');
  state.currentSegment = index;

  // Sync sticky player
  dom.audioSticky.currentTime = ms / 1000;
  dom.audioSticky.play().catch(() => {});
}

// ──────────────────────────────────────
// Export
// ──────────────────────────────────────

async function exportResults(format) {
  if (!state.results || !state.results.segments) {
    showToast('⚠️ لا توجد نتائج للتصدير', 'warning');
    return;
  }

  try {
    const resp = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: state.results.segments,
        format
      })
    });

    if (!resp.ok) throw new Error('Export failed');

    let blob;
    let filename;

    if (format === 'json') {
      const data = await resp.json();
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      filename = `quran-transcript-${Date.now()}.json`;
    } else {
      const text = await resp.text();
      const mime = format === 'srt' ? 'text/plain' : 'text/vtt';
      blob = new Blob([text], { type: mime });
      filename = `quran-transcript-${Date.now()}.${format}`;
    }

    downloadBlob(blob, filename);
    showToast(`✅ تم تصدير الملف بصيغة ${format.toUpperCase()}`, 'success');
  } catch (err) {
    showToast(`❌ فشل التصدير: ${err.message}`, 'error');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────
// UI Helpers
// ──────────────────────────────────────

function setProgress(label, pct) {
  dom.progressContainer.classList.remove('hidden');
  dom.progressLabel.textContent = label;
  dom.progressPct.textContent = `${Math.round(pct)}%`;
  dom.progressBar.style.width = `${pct}%`;
}

function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-700 border-emerald-500',
    error: 'bg-red-700 border-red-500',
    warning: 'bg-yellow-700 border-yellow-500',
    info: 'bg-blue-700 border-blue-500',
  };

  toast.className = `toast ${colors[type]} border text-white px-4 py-3 rounded-xl shadow-lg latin text-sm`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function getStatusClass(status) {
  const map = {
    excellent: 'card-excellent',
    good: 'card-good',
    partial: 'card-partial',
    poor: 'card-poor'
  };
  return map[status] || '';
}

function getStatusBadge(status, similarity) {
  const badges = {
    excellent: `<span class="bg-emerald-900 text-emerald-300 px-2 py-1 rounded text-xs latin">✓ ${similarity}%</span>`,
    good: `<span class="bg-yellow-900 text-yellow-300 px-2 py-1 rounded text-xs latin">~ ${similarity}%</span>`,
    partial: `<span class="bg-orange-900 text-orange-300 px-2 py-1 rounded text-xs latin">⚠ ${similarity}%</span>`,
    poor: `<span class="bg-red-900 text-red-300 px-2 py-1 rounded text-xs latin">✕ ${similarity}%</span>`,
  };
  return badges[status] || '';
}

// ──────────────────────────────────────
// Formatting
// ──────────────────────────────────────

function formatTimecode(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

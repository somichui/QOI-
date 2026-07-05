let originalImageData = null;   
let originalFileSize  = 0;
let originalFileName  = '';
let qoiEncoded        = null;   
let qoiPlusEncoded    = null;   
let qoiPlusHuffEncoded = null;  
let benchmarkChart    = null;
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const encodeBtn       = document.getElementById('encode-btn');
const downloadBtn     = document.getElementById('download-btn');
const huffmanToggle   = document.getElementById('huffman-toggle');
const loadingOverlay  = document.getElementById('loading-overlay');
const canvasOriginal  = document.getElementById('canvas-original');
const canvasDecoded   = document.getElementById('canvas-decoded');
const verificationMsg = document.getElementById('verification-msg');
const statOriginalSize = document.getElementById('stat-original-size');
const statQoiSize      = document.getElementById('stat-qoi-size');
const statQoiPlusSize  = document.getElementById('stat-qoiplus-size');
const statEncodeTime   = document.getElementById('stat-encode-time');
const statQoiRatio     = document.getElementById('stat-qoi-ratio');
const statQoiPlusRatio = document.getElementById('stat-qoiplus-ratio');
const worker = new Worker('worker.js?v=2');
let pendingCallbacks = {};
let callbackId = 0;
function workerCall(type, data = {}) {
  return new Promise((resolve, reject) => {
    const id = callbackId++;
    pendingCallbacks[id] = { resolve, reject };
    worker.postMessage({ type, id, ...data });
  });
}
worker.onmessage = (e) => {
  const { id, error, ...rest } = e.data;
  if (pendingCallbacks[id]) {
    if (error) {
      pendingCallbacks[id].reject(new Error(error));
    } else {
      pendingCallbacks[id].resolve(rest);
    }
    delete pendingCallbacks[id];
  }
};
worker.onerror = (err) => {
  console.error('[Worker error]', err);
};
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function animateValue(element, start, end, duration, formatter = String) {
  const startTime = performance.now();
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (end - start) * eased;
    element.textContent = formatter(Math.round(current));
    if (progress < 1) requestAnimationFrame(tick);
  }
  element.style.animation = 'countUp 0.4s ease both';
  requestAnimationFrame(tick);
}
function createGradient(ctx, height, colorTop, colorBottom) {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, colorTop);
  grad.addColorStop(1, colorBottom);
  return grad;
}
function verifyLossless(original, decoded) {
  if (original.length !== decoded.length) {
    return { match: false, diffPixels: -1 };
  }
  let diffPixels = 0;
  for (let i = 0; i < original.length; i += 4) {
    if (
      original[i]     !== decoded[i]     ||
      original[i + 1] !== decoded[i + 1] ||
      original[i + 2] !== decoded[i + 2] ||
      original[i + 3] !== decoded[i + 3]
    ) {
      diffPixels++;
    }
  }
  return { match: diffPixels === 0, diffPixels };
}
function drawImageFromPixels(canvas, pixels, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
  ctx.putImageData(imageData, 0, 0);
}
function setLoading(active) {
  loadingOverlay.classList.toggle('active', active);
  loadingOverlay.setAttribute('aria-hidden', String(!active));
}
['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evtName) => {
  document.addEventListener(evtName, (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
});
['dragenter', 'dragover'].forEach((evtName) => {
  dropZone.addEventListener(evtName, () => dropZone.classList.add('drag-over'));
});
['dragleave', 'drop'].forEach((evtName) => {
  dropZone.addEventListener(evtName, () => dropZone.classList.remove('drag-over'));
});
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) handleFile(file);
});
function handleFile(file) {
  originalFileSize = file.size;
  originalFileName = file.name.replace(/\.[^.]+$/, '');
  resetStats();
  encodeBtn.disabled = true;
  downloadBtn.disabled = true;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      originalImageData = {
        pixels: new Uint8Array(imageData.data.buffer),
        width: img.width,
        height: img.height,
      };
      drawImageFromPixels(canvasOriginal, originalImageData.pixels, img.width, img.height);
      const rawSizeBytes = img.width * img.height * 4;
      animateValue(statOriginalSize, 0, rawSizeBytes, 600, (v) => formatSize(v));
      document.getElementById('stat-file-size').textContent = `(from ${formatSize(originalFileSize)} file)`;
      encodeBtn.disabled = false;
      runEncodingPipeline();
    };
    img.onerror = () => {
      showVerification(false, 'Failed to decode the image file.');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function runEncodingPipeline() {
  if (!originalImageData) return;
  setLoading(true);
  encodeBtn.disabled = true;
  const { pixels, width, height } = originalImageData;
  try {
    const [qoiResult, qoiPlusResult, qoiPlusHuffResult] = await Promise.all([
      workerCall('encode_qoi', { pixels, width, height }),
      workerCall('encode_qoiplus', { pixels, width, height }),
      workerCall('encode_qoiplus_huffman', { pixels, width, height }),
    ]);
    qoiEncoded         = qoiResult.encoded;
    qoiPlusEncoded     = qoiPlusResult.encoded;
    qoiPlusHuffEncoded = qoiPlusHuffResult.encoded;
    const totalTime = Math.max(
      qoiResult.timeMs || 0,
      qoiPlusResult.timeMs || 0,
      qoiPlusHuffResult.timeMs || 0,
    );
    const activeEncoded = huffmanToggle.checked ? qoiPlusHuffEncoded : qoiPlusEncoded;
    const decodeResult = await workerCall('decode_qoiplus', {
      encoded: activeEncoded,
      huffman: huffmanToggle.checked,
    });
    const decodedPixels = decodeResult.pixels;
    const decodedWidth  = decodeResult.width;
    const decodedHeight = decodeResult.height;
    drawImageFromPixels(canvasDecoded, decodedPixels, decodedWidth, decodedHeight);
    const verification = verifyLossless(pixels, decodedPixels);
    if (verification.match) {
      showVerification(true, '✓ Lossless — 0 pixels differ');
    } else {
      const count = verification.diffPixels === -1
        ? 'size mismatch'
        : `${verification.diffPixels} pixels differ`;
      showVerification(false, `✗ Verification failed — ${count}`);
    }
    const qoiSize     = qoiEncoded.byteLength;
    const qoiPlusSize = activeEncoded.byteLength;
    animateValue(statQoiSize, 0, qoiSize, 600, (v) => formatSize(v));
    animateValue(statQoiPlusSize, 0, qoiPlusSize, 600, (v) => formatSize(v));
    animateValue(statEncodeTime, 0, totalTime, 400, (v) => `${v} ms`);
    const rawSize = pixels.length; 
    const qoiRatio = ((1 - qoiSize / rawSize) * 100).toFixed(1);
    const qoiPlusRatio = ((1 - qoiPlusSize / rawSize) * 100).toFixed(1);
    statQoiRatio.textContent = `↓ ${qoiRatio}%`;
    statQoiPlusRatio.textContent = `↓ ${qoiPlusRatio}%`;
    updateBenchmarkChart(rawSize, qoiSize, qoiPlusEncoded.byteLength, qoiPlusHuffEncoded.byteLength);
    downloadBtn.disabled = false;
  } catch (err) {
    console.error('Encoding pipeline error:', err);
    showVerification(false, `Error: ${err.message}`);
  } finally {
    setLoading(false);
    encodeBtn.disabled = false;
  }
}
function resetStats() {
  [statOriginalSize, statQoiSize, statQoiPlusSize, statEncodeTime].forEach((el) => {
    el.textContent = '—';
    el.style.animation = '';
  });
  statQoiRatio.textContent = '';
  statQoiPlusRatio.textContent = '';
  document.getElementById('stat-file-size').textContent = '';
  verificationMsg.className = 'verification';
  verificationMsg.textContent = '';
}
function showVerification(success, message) {
  verificationMsg.textContent = message;
  verificationMsg.className = `verification visible ${success ? 'success' : 'error'}`;
}
function updateBenchmarkChart(rawSize, qoiSize, qoiPlusSize, qoiPlusHuffSize) {
  const canvasEl = document.getElementById('benchmark-chart');
  const ctx = canvasEl.getContext('2d');
  const labels = ['Original (raw)', 'Vanilla QOI', 'QOI+', 'QOI+ Huffman'];
  const data   = [rawSize, qoiSize, qoiPlusSize, qoiPlusHuffSize];
  const gradients = [
    createGradient(ctx, 300, 'rgba(136,136,160,0.8)', 'rgba(136,136,160,0.3)'),
    createGradient(ctx, 300, 'rgba(99,102,241,0.85)',  'rgba(99,102,241,0.3)'),
    createGradient(ctx, 300, 'rgba(139,92,246,0.85)',  'rgba(139,92,246,0.3)'),
    createGradient(ctx, 300, 'rgba(6,182,212,0.85)',   'rgba(6,182,212,0.3)'),
  ];
  const borderColors = [
    'rgba(136,136,160,0.6)',
    'rgba(99,102,241,0.7)',
    'rgba(139,92,246,0.7)',
    'rgba(6,182,212,0.7)',
  ];
  if (benchmarkChart) {
    benchmarkChart.data.datasets[0].data = data;
    benchmarkChart.data.datasets[0].backgroundColor = gradients;
    benchmarkChart.data.datasets[0].borderColor = borderColors;
    benchmarkChart.update('active');
    return;
  }
  benchmarkChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Size (bytes)',
        data,
        backgroundColor: gradients,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 6,
        maxBarThickness: 64,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: 'easeOutCubic',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(20, 12, 28, 0.95)',
          titleColor: '#FFEBD2',
          bodyColor: '#FFEBD2',
          borderColor: 'rgba(255, 56, 100, 0.4)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          callbacks: {
            label: (context) => `Size: ${formatSize(context.raw)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#FF9E64',
            font: { family: 'Inter', size: 12 },
          },
          grid: { display: false },
          border: { color: 'rgba(255, 235, 210, 0.1)' },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#FF9E64',
            font: { family: 'Inter', size: 11 },
            callback: (value) => formatSize(value),
          },
          grid: {
            color: 'rgba(255, 235, 210, 0.05)',
          },
          border: { display: false },
        },
      },
    },
  });
}
downloadBtn.addEventListener('click', () => {
  const activeEncoded = huffmanToggle.checked ? qoiPlusHuffEncoded : qoiPlusEncoded;
  if (!activeEncoded) return;
  const blob = new Blob([activeEncoded], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${originalFileName || 'image'}.qoiplus`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
encodeBtn.addEventListener('click', () => {
  runEncodingPipeline();
});
huffmanToggle.addEventListener('change', () => {
  if (qoiPlusEncoded && qoiPlusHuffEncoded) {
    runEncodingPipeline();
  }
});
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.section').forEach((section, i) => {
    section.style.animationDelay = `${i * 0.08}s`;
  });
});
const scrollObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      scrollObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15, rootMargin: "0px 0px -50px 0px" });
document.querySelectorAll('.scroll-reveal').forEach(el => scrollObserver.observe(el));
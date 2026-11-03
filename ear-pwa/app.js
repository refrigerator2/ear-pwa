'use strict';

// Class order must match the training run (alphabetical folder names).
const CLASSES = ['Aom', 'Chornic', 'Earwax', 'Normal', 'OtitExterna', 'tympanoskleros'];
const LABELS = {
  Aom: 'Acute otitis media',
  Chornic: 'Chronic otitis media',
  Earwax: 'Earwax blocking the view',
  Normal: 'Normal eardrum',
  OtitExterna: 'Otitis externa (outer ear)',
  tympanoskleros: 'Tympanosclerosis (scarring)'
};
const NORMAL_THRESHOLD = 0.6; // "no signs" is only said when Normal wins with at least this confidence
const SIZE = 224;
const CROP = 0.7;             // training used the central 350 of 500 px

const $ = (id) => document.getElementById(id);
const ring = $('ring'), view = $('view'), statusEl = $('status');
const btnCamera = $('btnCamera'), btnLibrary = $('btnLibrary');
const resultEl = $('result'), details = $('details'), bars = $('bars');

let session = null;

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', !!isError);
}

function verdict(probs) {
  let top = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;
  const name = CLASSES[top], p = probs[top];

  if (name === 'Normal' && p >= NORMAL_THRESHOLD) {
    return { level: 'ok', title: 'No signs of an ear problem detected',
      text: 'This is not a diagnosis. If you have pain, discharge or hearing loss, see a doctor anyway.' };
  }
  if (name === 'Aom' || name === 'Chornic' || name === 'OtitExterna') {
    return { level: 'doctor', title: 'See a doctor',
      text: 'The photo looks like signs of an ear infection. Show the photo to a doctor.' };
  }
  if (name === 'Earwax') {
    return { level: 'retake', title: 'View blocked. Clean the ear and retake',
      text: 'Earwax is covering the eardrum, so it cannot be assessed. Retake the photo after the ear is cleaned.' };
  }
  if (name === 'tympanoskleros') {
    return { level: 'watch', title: 'Keep an eye on it',
      text: 'The photo shows scar-like changes on the eardrum. Mention it at your next doctor visit.' };
  }
  return { level: 'watch', title: 'Not sure. Retake the photo',
    text: 'The result is unclear. Retake the photo, and see a doctor if there is pain, discharge or hearing loss.' };
}

// Central square crop that matches how the training images were cut, then shrink in halving steps.
function toInputCanvas(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const side = Math.min(w, h) * CROP;
  const sx = (w - side) / 2, sy = (h - side) / 2;
  let size = Math.round(side);
  let c = document.createElement('canvas');
  c.width = c.height = size;
  let g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  while (size >= SIZE * 2) {
    const n = Math.floor(size / 2);
    const c2 = document.createElement('canvas');
    c2.width = c2.height = n;
    const g2 = c2.getContext('2d');
    g2.imageSmoothingQuality = 'high';
    g2.drawImage(c, 0, 0, size, size, 0, 0, n, n);
    c = c2; size = n;
  }
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const go = out.getContext('2d');
  go.imageSmoothingQuality = 'high';
  go.drawImage(c, 0, 0, size, size, 0, 0, SIZE, SIZE);
  return out;
}

function toTensor(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
  const f = new Float32Array(SIZE * SIZE * 3);
  for (let i = 0, j = 0; i < d.length; i += 4) {
    f[j++] = d[i]; f[j++] = d[i + 1]; f[j++] = d[i + 2]; // raw 0-255 RGB, the model normalises inside
  }
  return new ort.Tensor('float32', f, [1, SIZE, SIZE, 3]);
}

function render(probs) {
  const v = verdict(probs);
  resultEl.className = 'result show ' + v.level;
  $('rTitle').textContent = v.title;
  $('rText').textContent = v.text;

  const order = CLASSES.map((_, i) => i).sort((a, b) => probs[b] - probs[a]);
  bars.innerHTML = '';
  for (const i of order) {
    const pct = Math.round(probs[i] * 100);
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('div');
    label.textContent = LABELS[CLASSES[i]];
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = pct + '%';
    track.appendChild(fill);
    const num = document.createElement('div');
    num.className = 'pct';
    num.textContent = pct + '%';
    row.append(label, track, num);
    bars.appendChild(row);
  }
  details.hidden = false;
}

async function analyse(file) {
  if (!file || !session) return;
  resultEl.className = 'result';
  details.hidden = true;
  details.open = false;
  setStatus('Analysing…');
  ring.classList.add('busy');
  btnCamera.disabled = btnLibrary.disabled = true;

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();

    const canvas = toInputCanvas(img);
    view.getContext('2d').drawImage(canvas, 0, 0);
    ring.classList.add('has-photo');

    const feeds = {};
    feeds[session.inputNames[0]] = toTensor(canvas);
    const out = await session.run(feeds);
    const probs = Array.from(out[session.outputNames[0]].data);
    render(probs);
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus('Could not analyse this photo: ' + (e && e.message ? e.message : e), true);
  } finally {
    URL.revokeObjectURL(url);
    ring.classList.remove('busy');
    btnCamera.disabled = btnLibrary.disabled = false;
  }
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker not registered', e));
  }
  try {
    ort.env.wasm.wasmPaths = new URL('./ort/', location.href).href; // absolute, otherwise it resolves relative to the ort script itself
    ort.env.wasm.numThreads = 1; // multi-threading needs cross-origin isolation, which static hosting lacks
    session = await ort.InferenceSession.create('./ear.onnx', { executionProviders: ['wasm'] });
    setStatus('Ready. Works offline.');
    btnCamera.disabled = btnLibrary.disabled = false;
  } catch (e) {
    console.error(e);
    setStatus('Could not load the model: ' + (e && e.message ? e.message : e), true);
  }
}

btnCamera.addEventListener('click', () => $('inCamera').click());
btnLibrary.addEventListener('click', () => $('inLibrary').click());
for (const id of ['inCamera', 'inLibrary']) {
  $(id).addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = ''; // allow choosing the same file again
    analyse(f);
  });
}

init();

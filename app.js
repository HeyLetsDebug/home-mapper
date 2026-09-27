// ---------- IndexedDB (all data lives on this device only) ----------
const DB_NAME = 'homeInventoryDB';
const DB_VERSION = 1;
const STORE = 'spots';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(spot) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(spot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Small utilities ----------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function rotationFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 1000;
  return (hash % 5) - 2; // -2deg .. +2deg, stable per spot
}

function resizeImage(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error('toBlob failed'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64) {
  return fetch(base64).then((r) => r.blob());
}

// ---------- State ----------
let spots = [];
let currentSpot = null;
let editingPin = null;
let pendingPinCoords = null;
let galleryObjectUrls = [];
let currentSpotImageUrl = null;

// ---------- DOM refs ----------
const galleryView = document.getElementById('gallery-view');
const spotView = document.getElementById('spot-view');
const galleryGrid = document.getElementById('gallery-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const addBtn = document.getElementById('add-btn');
const cameraInput = document.getElementById('camera-input');
const backBtn = document.getElementById('back-btn');
const spotLabelInput = document.getElementById('spot-label-input');
const deleteSpotBtn = document.getElementById('delete-spot-btn');
const spotImage = document.getElementById('spot-image');
const pinsLayer = document.getElementById('pins-layer');
const imageWrap = document.getElementById('image-wrap');
const noteSheet = document.getElementById('note-sheet');
const noteText = document.getElementById('note-text');
const noteSave = document.getElementById('note-save');
const noteCancel = document.getElementById('note-cancel');
const noteDelete = document.getElementById('note-delete');
const menuBtn = document.getElementById('menu-btn');
const menuDropdown = document.getElementById('menu-dropdown');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importInput = document.getElementById('import-input');

// ---------- Rendering ----------
function renderGallery(filterText = '') {
  galleryObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  galleryObjectUrls = [];

  const q = filterText.trim().toLowerCase();
  const filtered = !q ? spots : spots.filter((s) =>
    (s.label || '').toLowerCase().includes(q) ||
    s.pins.some((p) => p.note.toLowerCase().includes(q))
  );

  galleryGrid.innerHTML = '';
  emptyState.classList.toggle('hidden', spots.length > 0);

  if (q && filtered.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'empty-state';
    msg.textContent = `No matches for "${filterText}".`;
    galleryGrid.appendChild(msg);
    return;
  }

  filtered.forEach((spot) => {
    const card = document.createElement('div');
    card.className = 'spot-card';
    card.style.setProperty('--rot', rotationFor(spot.id) + 'deg');

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'thumb-wrap';

    const img = document.createElement('img');
    const imgUrl = URL.createObjectURL(spot.imageBlob);
    galleryObjectUrls.push(imgUrl);
    img.src = imgUrl;
    img.alt = spot.label || 'Storage spot';
    thumbWrap.appendChild(img);

    if (spot.pins.length) {
      const count = document.createElement('div');
      count.className = 'pin-count';
      count.textContent = spot.pins.length;
      thumbWrap.appendChild(count);
    }
    card.appendChild(thumbWrap);

    const caption = document.createElement('div');
    caption.className = 'caption';
    caption.textContent = spot.label || 'Untitled spot';
    card.appendChild(caption);

    card.addEventListener('click', () => openSpot(spot.id));
    galleryGrid.appendChild(card);
  });
}

function renderPins() {
  pinsLayer.innerHTML = '';
  currentSpot.pins.forEach((pin, i) => {
    const el = document.createElement('button');
    el.className = 'pin';
    el.style.left = pin.x + '%';
    el.style.top = pin.y + '%';
    el.textContent = i + 1;
    el.setAttribute('aria-label', pin.note);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteSheet(pin);
    });
    pinsLayer.appendChild(el);
  });
}

// ---------- Navigation ----------
function showGallery() {
  spotView.classList.add('hidden');
  galleryView.classList.remove('hidden');
  currentSpot = null;
  renderGallery(searchInput.value);
}

function openSpot(id) {
  currentSpot = spots.find((s) => s.id === id);
  spotLabelInput.value = currentSpot.label || '';
  if (currentSpotImageUrl) URL.revokeObjectURL(currentSpotImageUrl);
  currentSpotImageUrl = URL.createObjectURL(currentSpot.imageBlob);
  spotImage.src = currentSpotImageUrl;
  renderPins();
  galleryView.classList.add('hidden');
  spotView.classList.remove('hidden');
}

async function createNewSpot(file) {
  const blob = await resizeImage(file);
  const spot = { id: uid(), imageBlob: blob, label: '', pins: [], createdAt: Date.now() };
  spots.unshift(spot);
  await dbPut(spot);
  openSpot(spot.id);
}

// ---------- Note sheet ----------
function openNoteSheet(pin) {
  editingPin = pin || null;
  noteText.value = pin ? pin.note : '';
  noteDelete.classList.toggle('hidden', !pin);
  noteSheet.classList.remove('hidden');
  setTimeout(() => noteText.focus(), 50);
}

function closeNoteSheet() {
  noteSheet.classList.add('hidden');
  editingPin = null;
  pendingPinCoords = null;
  noteText.value = '';
}

async function saveNote() {
  const text = noteText.value.trim();
  if (!text) { closeNoteSheet(); return; }

  if (editingPin) {
    editingPin.note = text;
  } else if (pendingPinCoords) {
    currentSpot.pins.push({ id: uid(), x: pendingPinCoords.x, y: pendingPinCoords.y, note: text, createdAt: Date.now() });
  }
  await dbPut(currentSpot);
  renderPins();
  closeNoteSheet();
}

async function deleteNote() {
  if (editingPin) {
    currentSpot.pins = currentSpot.pins.filter((p) => p.id !== editingPin.id);
    await dbPut(currentSpot);
    renderPins();
  }
  closeNoteSheet();
}

// ---------- Events ----------
addBtn.addEventListener('click', () => cameraInput.click());

cameraInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await createNewSpot(file);
  } catch (err) {
    alert("Couldn't load that photo — try a different one.");
  }
  cameraInput.value = '';
});

backBtn.addEventListener('click', showGallery);

spotLabelInput.addEventListener('change', async () => {
  currentSpot.label = spotLabelInput.value.trim();
  await dbPut(currentSpot);
});

deleteSpotBtn.addEventListener('click', async () => {
  if (!confirm('Delete this spot and all its notes?')) return;
  await dbDelete(currentSpot.id);
  spots = spots.filter((s) => s.id !== currentSpot.id);
  showGallery();
});

imageWrap.addEventListener('click', (e) => {
  if (e.target.closest('.pin')) return;
  const rect = spotImage.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  pendingPinCoords = { x, y };
  openNoteSheet(null);
});

noteSave.addEventListener('click', saveNote);
noteCancel.addEventListener('click', closeNoteSheet);
noteDelete.addEventListener('click', deleteNote);

searchInput.addEventListener('input', () => renderGallery(searchInput.value));

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  menuDropdown.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
    menuDropdown.classList.add('hidden');
  }
});

exportBtn.addEventListener('click', async () => {
  menuDropdown.classList.add('hidden');
  const data = await Promise.all(spots.map(async (s) => ({ ...s, imageBlob: await blobToBase64(s.imageBlob) })));
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `home-inventory-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener('click', () => {
  menuDropdown.classList.add('hidden');
  importInput.click();
});

importInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    for (const item of data) {
      const blob = await base64ToBlob(item.imageBlob);
      await dbPut({ ...item, imageBlob: blob });
    }
    spots = await dbGetAll();
    renderGallery(searchInput.value);
    alert('Backup imported.');
  } catch (err) {
    alert("Couldn't read that backup file.");
  }
  importInput.value = '';
});

// ---------- Init ----------
(async function init() {
  spots = await dbGetAll();
  renderGallery();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

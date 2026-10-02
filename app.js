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

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function rotationFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 1000;
  return (hash % 5) - 2;
}

async function resizeImage(file, maxDim = 1400, quality = 0.82) {
  if (!file || !file.size) throw new Error('empty image');

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      let width = bitmap.width;
      let height = bitmap.height;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
      });
      if (blob) return blob;
    } catch (err) {}
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (error, blob) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      error ? reject(error) : resolve(blob);
    };
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round(height * (maxDim / width));
            width = maxDim;
          } else {
            width = Math.round(width * (maxDim / height));
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return finish(new Error('canvas unavailable'));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          blob ? finish(null, blob) : finish(new Error('toBlob failed'));
        }, 'image/jpeg', quality);
      } catch (err) {
        finish(err);
      }
    };
    img.onerror = () => finish(new Error('image load failed'));
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

let spots = [];
let currentSpot = null;
let editingPin = null;
let pendingPinCoords = null;
let galleryObjectUrls = [];
let currentSpotImageUrl = null;
let spotDirty = false;
let viewMode = 'all';
let deferredInstallPrompt = null;
let captureBusy = false;

const galleryView = document.getElementById('gallery-view');
const spotView = document.getElementById('spot-view');
const galleryGrid = document.getElementById('gallery-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const addBtn = document.getElementById('add-btn');
const cameraInput = document.getElementById('camera-input');
const backBtn = document.getElementById('back-btn');
const spotLabelInput = document.getElementById('spot-label-input');
const saveSpotBtn = document.getElementById('save-spot-btn');
const deleteSpotBtn = document.getElementById('delete-spot-btn');
const favoriteBtn = document.getElementById('favorite-btn');
const subspotBtn = document.getElementById('subspot-btn');
const parentSpotInput = document.getElementById('parent-spot-input');
const locationSuggestions = document.getElementById('location-suggestions');
const spotBreadcrumb = document.getElementById('spot-breadcrumb');
const installBtn = document.getElementById('install-btn');
const navHome = document.getElementById('nav-home');
const navFavorites = document.getElementById('nav-favorites');
const navInstall = document.getElementById('nav-install');
const subspotInput = document.getElementById('subspot-input');
const noteSubspot = document.getElementById('note-subspot');
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
const exportPdfBtn = document.getElementById('export-pdf-btn');
const importBtn = document.getElementById('import-btn');
const importInput = document.getElementById('import-input');
const pdfReport = document.getElementById('pdf-report');

function parentChain(spot) {
  const chain = [];
  let cursor = spot;
  const seen = new Set();
  while (cursor && cursor.parentId && !seen.has(cursor.parentId)) {
    seen.add(cursor.parentId);
    cursor = spots.find((s) => s.id === cursor.parentId);
    if (cursor) chain.unshift(cursor);
  }
  return chain;
}

function breadcrumbText(spot) {
  const location = (spot.locationText || '').trim();
  const chain = parentChain(spot);
  const parts = [];
  if (location && !chain.length) parts.push(location);
  parts.push(...chain.map((s) => s.label || 'Untitled spot'));
  parts.push(spot.label || 'Untitled spot');
  return parts.join(' › ');
}

function locationOptions() {
  const values = [];
  const seen = new Set();
  spots.forEach((spot) => {
    const label = (spot.label || '').trim();
    if (!label || seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    values.push(label);
  });
  return values.sort((a, b) => a.localeCompare(b));
}

function renderLocationSuggestions() {
  locationSuggestions.innerHTML = '';
  locationOptions().forEach((label) => {
    const option = document.createElement('option');
    option.value = label;
    locationSuggestions.appendChild(option);
  });
}

function updateLocationInput() {
  if (!currentSpot) return;
  if (currentSpot.parentId) {
    const parent = spots.find((s) => s.id === currentSpot.parentId);
    parentSpotInput.value = parent ? (parent.label || '') : '';
  } else {
    parentSpotInput.value = currentSpot.locationText || '';
  }
}

function setViewMode(mode) {
  viewMode = mode;
  navHome.classList.toggle('active', mode === 'all');
  navFavorites.classList.toggle('active', mode === 'favorites');
  renderGallery(searchInput.value);
}

function renderParentOptions() {
  renderLocationSuggestions();
  updateLocationInput();
}

function updateFavoriteButton() {
  favoriteBtn.textContent = currentSpot?.favorite ? '★' : '☆';
  favoriteBtn.classList.toggle('selected', !!currentSpot?.favorite);
}

function renderGallery(filterText = '') {
  galleryObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  galleryObjectUrls = [];

  const q = filterText.trim().toLowerCase();
  const modeFiltered = viewMode === 'favorites' ? spots.filter((s) => s.favorite) : spots;
  const filtered = !q ? modeFiltered : modeFiltered.filter((s) =>
    (s.label || '').toLowerCase().includes(q) ||
    s.pins.some((p) => p.note.toLowerCase().includes(q)) ||
    breadcrumbText(s).toLowerCase().includes(q)
  );

  galleryGrid.innerHTML = '';
  emptyState.classList.toggle('hidden', modeFiltered.length > 0);

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
    if (spot.favorite) card.classList.add('is-favorite');
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

    const favorite = document.createElement('button');
    favorite.className = 'card-favorite';
    favorite.textContent = spot.favorite ? '★' : '☆';
    favorite.setAttribute('aria-label', spot.favorite ? 'Remove favorite' : 'Add favorite');
    favorite.addEventListener('click', async (e) => {
      e.stopPropagation();
      spot.favorite = !spot.favorite;
      await dbPut(spot);
      renderGallery(searchInput.value);
    });
    thumbWrap.appendChild(favorite);

    const caption = document.createElement('div');
    caption.className = 'caption';
    caption.textContent = spot.label || 'Untitled spot';
    if (spot.parentId) {
      const parent = document.createElement('small');
      parent.className = 'card-parent';
      parent.textContent = breadcrumbText(spot).replace((spot.label || 'Untitled spot'), '').replace(/ › $/, '');
      caption.appendChild(parent);
    }
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

function updateSaveButton() {
  saveSpotBtn.textContent = spotDirty ? 'Save' : 'Saved';
  saveSpotBtn.classList.toggle('saved', !spotDirty);
}

function markSpotDirty() {
  spotDirty = true;
  updateSaveButton();
}

async function saveCurrentSpot() {
  if (!currentSpot) return;
  currentSpot.label = spotLabelInput.value.trim();
  const locationValue = parentSpotInput.value.trim();
  const matchingParent = spots.find((s) =>
    s.id !== currentSpot.id &&
    (s.label || '').trim().toLowerCase() === locationValue.toLowerCase()
  );
  if (matchingParent) {
    currentSpot.parentId = matchingParent.id;
    currentSpot.locationText = '';
  } else {
    currentSpot.parentId = null;
    currentSpot.locationText = locationValue;
  }
  await dbPut(currentSpot);
  spotDirty = false;
  updateSaveButton();
  renderGallery(searchInput.value);
}

function showGallery() {
  spotView.classList.add('hidden');
  galleryView.classList.remove('hidden');
  currentSpot = null;
  spotDirty = false;
  updateSaveButton();
  renderGallery(searchInput.value);
}

function openSpot(id) {
  currentSpot = spots.find((s) => s.id === id);
  spotLabelInput.value = currentSpot.label || '';
  renderParentOptions();
  spotBreadcrumb.textContent = (currentSpot.parentId || currentSpot.locationText) ? breadcrumbText(currentSpot) : '';
  updateFavoriteButton();
  spotDirty = false;
  updateSaveButton();
  if (currentSpotImageUrl) URL.revokeObjectURL(currentSpotImageUrl);
  currentSpotImageUrl = URL.createObjectURL(currentSpot.imageBlob);
  spotImage.src = currentSpotImageUrl;
  renderPins();
  galleryView.classList.add('hidden');
  spotView.classList.remove('hidden');
}

async function createNewSpot(file, parentId = null) {
  let blob;
  try {
    blob = await resizeImage(file);
  } catch (err) {
    blob = file.slice(0, file.size, file.type || 'image/jpeg');
  }
  if (!blob || !blob.size) throw new Error('image could not be stored');
  const spot = { id: uid(), imageBlob: blob, label: '', pins: [], parentId, locationText: '', favorite: false, createdAt: Date.now() };
  await dbPut(spot);
  spots.unshift(spot);
  renderGallery(searchInput.value);
  openSpot(spot.id);
}

function openNoteSheet(pin) {
  editingPin = pin || null;
  noteText.value = pin ? pin.note : '';
  noteDelete.classList.toggle('hidden', !pin);
  noteSubspot.classList.toggle('hidden', !pin);
  noteSheet.classList.remove('hidden');
  setTimeout(() => noteText.focus(), 50);
}

function closeNoteSheet() {
  noteSheet.classList.add('hidden');
  editingPin = null;
  pendingPinCoords = null;
  noteText.value = '';
  noteSubspot.classList.add('hidden');
}

function saveNote() {
  const text = noteText.value.trim();
  if (!text) { closeNoteSheet(); return; }

  if (editingPin) {
    editingPin.note = text;
  } else if (pendingPinCoords) {
    currentSpot.pins.push({ id: uid(), x: pendingPinCoords.x, y: pendingPinCoords.y, note: text, createdAt: Date.now() });
  }
  markSpotDirty();
  renderPins();
  closeNoteSheet();
}

function deleteNote() {
  if (editingPin) {
    currentSpot.pins = currentSpot.pins.filter((p) => p.id !== editingPin.id);
    markSpotDirty();
    renderPins();
  }
  closeNoteSheet();
}

async function imageWithPins(spot) {
  const url = URL.createObjectURL(spot.imageBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const radius = Math.max(16, Math.min(canvas.width, canvas.height) * 0.028);
    const fontSize = Math.max(16, radius * 0.95);
    spot.pins.forEach((pin, i) => {
      const x = canvas.width * pin.x / 100;
      const y = canvas.height * pin.y / 100;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#2E4A3B';
      ctx.fill();
      ctx.lineWidth = Math.max(3, radius * 0.12);
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y);
    });
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportPdfReport() {
  menuDropdown.classList.add('hidden');
  if (!spots.length) {
    alert('Nothing to export yet.');
    return;
  }
  if (currentSpot && spotDirty) await saveCurrentSpot();

  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    alert('Please allow pop-ups for this site to export the PDF.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write('<!doctype html><html><head><title>Where’s My Stuff</title><style>body{font-family:Arial,sans-serif;color:#26241F;margin:0} .cover{height:92vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;page-break-after:always}.cover h1{font-size:30px;margin:0 0 10px}.cover p{margin:5px 0;color:#666}.spot{page-break-after:always;break-after:page}.spot:last-child{page-break-after:auto}.spot h2{font-size:22px;margin:0 0 14px}.spot img{display:block;width:100%;max-height:62vh;object-fit:contain;margin-bottom:18px}.spot ol{margin:0;padding-left:24px;font-size:14px;line-height:1.5}.spot li{margin-bottom:7px}@page{size:A4;margin:12mm}</style></head><body><div id="report"></div></body></html>');
  printWindow.document.close();

  const report = printWindow.document.getElementById('report');
  const cover = printWindow.document.createElement('section');
  cover.className = 'cover';
  cover.innerHTML = '<h1>Where’s My Stuff</h1><p>Home inventory report</p><p>' + new Date().toLocaleDateString() + '</p>';
  report.appendChild(cover);

  for (const spot of spots) {
    const section = printWindow.document.createElement('section');
    section.className = 'spot';

    const title = printWindow.document.createElement('h2');
    title.textContent = breadcrumbText(spot);
    section.appendChild(title);

    const img = printWindow.document.createElement('img');
    img.alt = spot.label || 'Storage spot';
    img.src = await imageWithPins(spot);
    section.appendChild(img);

    if (spot.pins.length) {
      const list = printWindow.document.createElement('ol');
      spot.pins.forEach((pin) => {
        const item = printWindow.document.createElement('li');
        item.textContent = pin.note;
        list.appendChild(item);
      });
      section.appendChild(list);
    } else {
      const empty = printWindow.document.createElement('p');
      empty.textContent = 'No mapped items.';
      section.appendChild(empty);
    }

    report.appendChild(section);
  }

  const images = Array.from(report.querySelectorAll('img'));
  await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
  })));

  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
  }, 250);
}
addBtn.addEventListener('click', () => {
  if (captureBusy) return;
  cameraInput.value = '';
  cameraInput.click();
});

cameraInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  cameraInput.value = '';
  if (!file || captureBusy) return;
  captureBusy = true;
  addBtn.disabled = true;
  const originalText = addBtn.textContent;
  addBtn.textContent = '…';
  try {
    await createNewSpot(file, cameraInput.dataset.parentId || null);
  } catch (err) {
    alert("Couldn't save that photo. Please try again.");
  } finally {
    captureBusy = false;
    addBtn.disabled = false;
    addBtn.textContent = originalText;
    cameraInput.dataset.parentId = '';
  }
});

navHome.addEventListener('click', () => setViewMode('all'));
navFavorites.addEventListener('click', () => setViewMode('favorites'));

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.classList.remove('hidden');
  navInstall.classList.remove('hidden');
});

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.classList.add('hidden');
  navInstall.classList.add('hidden');
}
installBtn.addEventListener('click', installApp);
navInstall.addEventListener('click', installApp);

backBtn.addEventListener('click', async () => {
  if (!spotDirty) {
    showGallery();
    return;
  }
  const save = confirm('You have unsaved changes. Press OK to save, or Cancel to discard them.');
  if (save) {
    await saveCurrentSpot();
  } else {
    spots = await dbGetAll();
  }
  showGallery();
});

saveSpotBtn.addEventListener('click', saveCurrentSpot);

favoriteBtn.addEventListener('click', () => {
  if (!currentSpot) return;
  currentSpot.favorite = !currentSpot.favorite;
  updateFavoriteButton();
  markSpotDirty();
});

parentSpotInput.addEventListener('input', () => {
  if (!currentSpot) return;
  const value = parentSpotInput.value.trim();
  const matchingParent = spots.find((s) =>
    s.id !== currentSpot.id &&
    (s.label || '').trim().toLowerCase() === value.toLowerCase()
  );
  if (matchingParent) {
    currentSpot.parentId = matchingParent.id;
    currentSpot.locationText = '';
  } else {
    currentSpot.parentId = null;
    currentSpot.locationText = value;
  }
  spotBreadcrumb.textContent = value ? breadcrumbText(currentSpot) : (currentSpot.label ? currentSpot.label : '');
  markSpotDirty();
});

subspotBtn.addEventListener('click', () => {
  if (!currentSpot) return;
  subspotInput.dataset.parentId = currentSpot.id;
  subspotInput.click();
});

subspotInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  subspotInput.value = '';
  if (!file) return;
  try {
    await createNewSpot(file, subspotInput.dataset.parentId || null);
  } catch (err) {
    alert("Couldn't save that photo. Please try again.");
  } finally {
    subspotInput.dataset.parentId = '';
  }
});

spotLabelInput.addEventListener('input', markSpotDirty);

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

exportPdfBtn.addEventListener('click', exportPdfReport);

exportBtn.addEventListener('click', async () => {
  menuDropdown.classList.add('hidden');
  if (currentSpot && spotDirty) await saveCurrentSpot();
  const data = await Promise.all(spots.map(async (s) => ({ ...s, imageBlob: await blobToBase64(s.imageBlob) })));
  const backup = { version: 2, app: "Where's My Stuff", exportedAt: new Date().toISOString(), spots: data };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
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
    const parsed = JSON.parse(text);
    const data = Array.isArray(parsed) ? parsed : parsed.spots;
    if (!Array.isArray(data) || !data.length) throw new Error('Invalid or empty backup.');
    const valid = data.filter((item) => item && item.id && item.imageBlob && Array.isArray(item.pins));
    if (!valid.length) throw new Error('No valid locations found.');
    const replace = confirm('Restore ' + valid.length + ' location(s). Press OK to replace your current inventory, or Cancel to merge it.');
    if (replace) {
      const existing = await dbGetAll();
      for (const item of existing) await dbDelete(item.id);
    }
    for (const item of valid) {
      const blob = await base64ToBlob(item.imageBlob);
      await dbPut({
        id: item.id,
        imageBlob: blob,
        label: item.label || '',
        pins: Array.isArray(item.pins) ? item.pins : [],
        parentId: item.parentId || null,
        locationText: item.locationText || '',
        favorite: !!item.favorite,
        createdAt: item.createdAt || Date.now()
      });
    }
    spots = await dbGetAll();
    setViewMode('all');
    alert('Backup restored successfully.');
  } catch (err) {
    alert("Couldn't read that backup file.");
  }
  importInput.value = '';
});

(async function init() {
  spots = await dbGetAll();
  spots.forEach((spot) => {
    if (!Array.isArray(spot.pins)) spot.pins = [];
    if (!('favorite' in spot)) spot.favorite = false;
    if (!('parentId' in spot)) spot.parentId = null;
    if (!('locationText' in spot)) spot.locationText = '';
  });
  renderGallery();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

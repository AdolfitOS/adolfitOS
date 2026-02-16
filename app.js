/*
  AdolfitOS SPA - focused on identification, flashing, and serial monitor.
  Uses esptool-js bundle included via script tag.
*/
const connectBtn = document.getElementById('connectBtn');
const chipModelEl = document.getElementById('chip-model');
const macEl = document.getElementById('mac-address');
const copyMacBtn = document.getElementById('copyMac');
const statusEl = document.getElementById('status');

const flashMainBtn = document.getElementById('flashMain');
const flashTestBtn = document.getElementById('flashTest');
const installCountEl = document.getElementById('installCount');
const devicesCountEl = document.getElementById('devicesCount');

const consoleEl = document.getElementById('console');
const clearConsoleBtn = document.getElementById('clearConsole');
const pauseLogBtn = document.getElementById('pauseLog');
const consoleSend = document.getElementById('consoleSend');
const sendBtn = document.getElementById('sendBtn');

let port = null;
let reader = null;
let writer = null;
let keepReading = false;
let paused = false;
let installCount = 0;

const SEEN_KEY = 'adolfitos_seen_macs_v1';
let seenMacs = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
devicesCountEl.textContent = seenMacs.size;
installCountEl.textContent = installCount;

// Feature detect
if (!('serial' in navigator)) {
  document.body.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;color:#f66;background:#071207;font-family:system-ui;padding:20px">
    Navegador no compatible con Web Serial API.
  </div>`;
  throw new Error('Web Serial API not available');
}

// Utilities
function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function logConsole(line){
  if (paused) return;
  const wrapper = document.createElement('div');
  const time = `[${new Date().toLocaleTimeString()}] `;
  wrapper.innerHTML = `<span style="opacity:0.6">${escapeHtml(time)}</span>${escapeHtml(line)}`;
  consoleEl.appendChild(wrapper);
  consoleEl.scrollTop = consoleEl.scrollHeight;
  while (consoleEl.children.length > 2000) consoleEl.removeChild(consoleEl.firstChild);
}

// register new MACs
function registerMac(mac){
  if (!mac) return;
  const normalized = mac.trim().toLowerCase();
  if (!normalized) return;
  if (!seenMacs.has(normalized)){
    seenMacs.add(normalized);
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seenMacs)));
    devicesCountEl.textContent = seenMacs.size;
    logConsole('Nuevo dispositivo identificado: ' + normalized);
  }
}

// Serial read loop
async function readLoop() {
  if (!port) return;
  keepReading = true;
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  const readerLocal = textDecoder.readable.getReader();
  reader = readerLocal;
  try {
    let buffer = '';
    while (keepReading) {
      const { value, done } = await readerLocal.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r/g,'').trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        logConsole(line);
      }
    }
  } catch (e){
    logConsole('Lectura serial terminada: ' + (e.message || e));
  } finally {
    try { readerLocal.releaseLock(); } catch(e){}
  }
}

// Connect button behavior
connectBtn.addEventListener('click', async () => {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    statusEl.textContent = 'Conectado';
    logConsole('Puerto abierto a 115200 baudios.');

    // prepare writer
    const textEncoder = new TextEncoderStream();
    textEncoder.readable.pipeTo(port.writable);
    writer = textEncoder.writable.getWriter();

    // Use esptool-js (global window.ESPT) and try main_fn
    try {
      if (!window.ESPT) {
        logConsole('esptool-js no disponible en la página (window.ESPT undefined).');
      } else {
        const transport = new window.ESPT.SerialTransport(port);
        const esploader = new window.ESPT.ESP32ROM(transport);
        await esploader.connect();
        logConsole('Intentando detección automática mediante esptool-js main_fn()...');
        try {
          if (typeof esploader.main_fn === 'function') {
            const info = await esploader.main_fn();
            const chipName = info.chip_name || info.chip_description || info.name || info.chip || null;
            const macRaw = info.mac || info.efuse_mac || (info.mac_address ? info.mac_address : null);
            if (chipName) {
              chipModelEl.textContent = chipName;
              logConsole('Chip detectado: ' + chipName);
            }
            if (macRaw) {
              macEl.textContent = macRaw;
              registerMac(macRaw);
              logConsole('MAC detectada: ' + macRaw);
            }
          } else {
            logConsole('esptool-js: main_fn no disponible en este dispositivo.');
          }
        } catch (errMain) {
          logConsole('Error en main_fn(): ' + (errMain.message || errMain));
        }

        // fallback attempts: chip_info and read_mac
        try {
          const chipInfo = await esploader.chip_info();
          if (chipInfo) {
            if (!chipModelEl.textContent || chipModelEl.textContent === '—') {
              chipModelEl.textContent = chipInfo.chip_description || chipInfo.chip_name || 'ESP32';
              logConsole('chip_info: ' + (chipInfo.chip_description || chipInfo.chip_name || 'ESP32'));
            }
            if (chipInfo.efuse_mac && (!macEl.textContent || macEl.textContent === '—')) {
              macEl.textContent = chipInfo.efuse_mac;
              registerMac(chipInfo.efuse_mac);
              logConsole('MAC desde chip_info: ' + chipInfo.efuse_mac);
            }
          }
        } catch (errCI){ /* ignore */ }

        try {
          const macObj = await esploader.read_mac();
          if (macObj && macObj.mac) {
            macEl.textContent = macObj.mac;
            registerMac(macObj.mac);
            logConsole('MAC desde read_mac: ' + macObj.mac);
          }
        } catch (errRM){ /* ignore */ }

        try { await transport.close(); } catch(e){}
      }
    } catch (e) {
      logConsole('Error durante la detección via esptool-js: ' + (e.message || e));
    }

    // Start serial read loop
    readLoop();
  } catch (e) {
    statusEl.textContent = 'Desconectado';
    logConsole('Error al conectar: ' + (e.message || e));
  }
});

// Copy MAC action
copyMacBtn.addEventListener('click', async () => {
  if (macEl.textContent && macEl.textContent !== '—') {
    try {
      await navigator.clipboard.writeText(macEl.textContent);
      logConsole('MAC copiada al portapapeles: ' + macEl.textContent);
    } catch(e){ logConsole('No se pudo copiar MAC: ' + (e.message || e)); }
  }
});

// Console controls
clearConsoleBtn.addEventListener('click', () => { consoleEl.innerHTML=''; });
pauseLogBtn.addEventListener('click', () => { paused = !paused; pauseLogBtn.textContent = paused ? '▶️' : '⏸️'; });

sendBtn.addEventListener('click', async () => {
  const txt = consoleSend.value;
  if (!txt || !writer) return;
  try {
    await writer.write(txt + '\n');
    logConsole('> ' + txt);
  } catch(e){
    logConsole('Error enviando: ' + (e.message || e));
  }
  consoleSend.value = '';
});

// Flash firmware (files assumed in same folder)
async function flashFirmware(path, volatile=false){
  if (!port) { logConsole('Primero conecte un puerto'); return; }
  logConsole(`Iniciando flasheo ${path} ...`);
  try {
    if (!window.ESPT) { logConsole('esptool-js no disponible en la página. No se puede flashear.'); return; }
    const resp = await fetch(path);
    if (!resp.ok) throw new Error('No se pudo descargar ' + path);
    const blob = await resp.arrayBuffer();

    const transport = new window.ESPT.SerialTransport(port);
    const esploader = new window.ESPT.ESP32ROM(transport);

    logConsole('Conectando al bootloader (asegure que el dispositivo esté en modo bootloader)...');
    await esploader.connect();
    logConsole('Conectado al bootloader. Preparando escritura de flash...');

    const chunkSize = 0x1000;
    const sectors = Math.ceil(blob.byteLength / chunkSize);

    await esploader.flash_begin(sectors, chunkSize, 0);
    for (let off=0; off<blob.byteLength; off+=chunkSize){
      const chunk = new Uint8Array(blob.slice(off, off+chunkSize));
      await esploader.flash_data(chunk);
      logConsole(`Flasheado ${Math.min(off+chunkSize, blob.byteLength)}/${blob.byteLength}`);
    }
    await esploader.flash_finish();
    try { await transport.close(); } catch(e){}
    installCount++;
    installCountEl.textContent = installCount;
    logConsole('Flasheo completado: ' + path);
  } catch (e) {
    logConsole('Error de flasheo: ' + (e.message || e));
  }
}

flashMainBtn.addEventListener('click', () => flashFirmware('./firmware.bin', false));
flashTestBtn.addEventListener('click', () => flashFirmware('./diagnostico.bin', true));

// Cleanup on unload
window.addEventListener('beforeunload', async () => {
  keepReading = false;
  paused = true;
  try {
    if (reader) { await reader.cancel(); reader = null; }
    if (writer) { try { writer.releaseLock(); } catch(e){} writer = null; }
    if (port) { await port.close(); port = null; }
  } catch(e){}
});

// small UX: tapping console copies line
consoleEl.addEventListener('click', (ev) => {
  const txt = ev.target.textContent;
  if (txt) navigator.clipboard.writeText(txt);
});

logConsole('AdolfitOS listo. Pulse "CONECTAR DISPOSITIVO".');

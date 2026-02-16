/*
  AdolfitOS SPA - Versión con persistencia y compatibilidad extendida (S3, N16, R1).
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

// --- MEJORA 1: PERSISTENCIA DE CONTADORES ---
const SEEN_KEY = 'adolfitos_seen_macs_v1';
const INSTALL_KEY = 'adolfitos_install_count';

// Cargamos de memoria local o empezamos en 0
let seenMacs = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
let installCount = parseInt(localStorage.getItem(INSTALL_KEY) || '0');

// Actualizar la pantalla al cargar
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
  if (!normalized || normalized === "—") return;
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
  // Usamos un try-catch global para el loop
  try {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    const readerLocal = textDecoder.readable.getReader();
    reader = readerLocal;
    
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
    logConsole('Lectura serial pausada para identificación o error.');
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

    // --- MEJORA 2: IDENTIFICACIÓN ROBUSTA (S3, N16, R1) ---
    try {
      if (!window.ESPT) {
        logConsole('esptool-js no disponible (window.ESPT undefined).');
      } else {
        const transport = new window.ESPT.SerialTransport(port);
        const esploader = new window.ESPT.ESP32ROM(transport);
        
        logConsole('Sincronizando... Si falla, mantén presionado BOOT.');
        await esploader.connect();

        // Intento 1: main_fn (el más completo)
        try {
          if (typeof esploader.main_fn === 'function') {
            const info = await esploader.main_fn();
            const chipName = info.chip_name || info.chip_description || info.name || info.chip;
            const macRaw = info.mac || info.efuse_mac || info.mac_address;
            
            if (chipName) chipModelEl.textContent = chipName;
            if (macRaw) {
                macEl.textContent = macRaw;
                registerMac(macRaw);
            }
          }
        } catch (err) {}

        // Intento 2 (Fallback): chip_info
        if (chipModelEl.textContent === '—') {
          try {
            const chipInfo = await esploader.chip_info();
            chipModelEl.textContent = chipInfo.chip_description || 'ESP32';
            if (chipInfo.efuse_mac) {
                macEl.textContent = chipInfo.efuse_mac;
                registerMac(chipInfo.efuse_mac);
            }
          } catch (err) {}
        }

        // Intento 3 (Fallback): read_mac directo
        if (macEl.textContent === '—') {
          try {
            const macObj = await esploader.read_mac();
            if (macObj) {
                macEl.textContent = macObj;
                registerMac(macObj);
            }
          } catch (err) {}
        }

        logConsole('Identificación finalizada: ' + chipModelEl.textContent);
        
        // Cerramos transporte para liberar el puerto para el monitor
        try { await transport.close(); } catch(e){}
      }
    } catch (e) {
      logConsole('Nota: Identificación omitida o chip no respondió (Modo Monitor).');
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
      logConsole('MAC copiada: ' + macEl.textContent);
    } catch(e){ logConsole('Error al copiar.'); }
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
  } catch(e){ logConsole('Error enviando.'); }
  consoleSend.value = '';
});

// Flash firmware
async function flashFirmware(path, volatile=false){
  if (!port) { logConsole('Primero conecte un puerto'); return; }
  logConsole(`Iniciando flasheo ${path} ...`);
  try {
    if (!window.ESPT) { logConsole('Librería esptool no cargada.'); return; }
    const resp = await fetch(path);
    if (!resp.ok) throw new Error('Archivo no encontrado: ' + path);
    const blob = await resp.arrayBuffer();

    const transport = new window.ESPT.SerialTransport(port);
    const esploader = new window.ESPT.ESP32ROM(transport);

    await esploader.connect();
    
    const chunkSize = 0x1000;
    const sectors = Math.ceil(blob.byteLength / chunkSize);

    await esploader.flash_begin(sectors, chunkSize, 0);
    for (let off=0; off<blob.byteLength; off+=chunkSize){
      const chunk = new Uint8Array(blob.slice(off, off+chunkSize));
      await esploader.flash_data(chunk);
      // Opcional: Log de progreso cada 10% para no saturar
    }
    await esploader.flash_finish();
    try { await transport.close(); } catch(e){}
    
    // --- MEJORA 3: GUARDAR CONTADOR DE INSTALACIÓN ---
    installCount++;
    localStorage.setItem(INSTALL_KEY, installCount);
    installCountEl.textContent = installCount;
    
    logConsole('¡Flasheo completado con éxito!');
  } catch (e) {
    logConsole('Error de flasheo: ' + (e.message || e));
  }
}

flashMainBtn.addEventListener('click', () => flashFirmware('./firmware.bin', false));
flashTestBtn.addEventListener('click', () => flashFirmware('./diagnostico.bin', true));

// Cleanup on unload
window.addEventListener('beforeunload', async () => {
  keepReading = false;
  try {
    if (reader) await reader.cancel();
    if (port) await port.close();
  } catch(e){}
});

logConsole('AdolfitOS listo. Pulse "CONECTAR DISPOSITIVO".');

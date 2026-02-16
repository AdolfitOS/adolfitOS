/*
  AdolfitOS SPA - Versión Final Corregida (Compatibilidad S3, N16 y Contadores)
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

let seenMacs = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
let installCount = parseInt(localStorage.getItem(INSTALL_KEY) || '0');

devicesCountEl.textContent = seenMacs.size;
installCountEl.textContent = installCount;

if (!('serial' in navigator)) {
  document.body.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;color:#f66;background:#071207;font-family:system-ui;padding:20px">
    Navegador no compatible con Web Serial API.
  </div>`;
  throw new Error('Web Serial API not available');
}

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

async function readLoop() {
  if (!port) return;
  keepReading = true;
  try {
    const textDecoder = new TextDecoderStream();
    port.readable.pipeTo(textDecoder.writable);
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
    logConsole('Lectura serial pausada o terminada.');
  }
}

// Connect button behavior
connectBtn.addEventListener('click', async () => {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    statusEl.textContent = 'Conectado';
    logConsole('Puerto abierto a 115200 baudios.');

    const textEncoder = new TextEncoderStream();
    textEncoder.readable.pipeTo(port.writable);
    writer = textEncoder.writable.getWriter();

    // --- MEJORA 2: IDENTIFICACIÓN CORREGIDA (esptool-js) ---
    try {
      const ESP = window.esptool; // Cambiado de ESPT a esptool
      if (!ESP) {
        logConsole('Error: Librería esptool no encontrada.');
      } else {
        const transport = new ESP.Transport(port);
        const esploader = new ESP.ESPLoader(transport, 115200);
        
        logConsole('Sincronizando... Si es S3/N16, mantén BOOT si no conecta.');
        
        // main_fn despierta el chip y devuelve la info en un solo paso
        await esploader.main_fn();

        const chipName = await esploader.chip.get_chip_description();
        const macAddr = await esploader.chip.read_mac();

        if (chipName) {
            chipModelEl.textContent = chipName;
            logConsole('Chip detectado: ' + chipName);
        }
        if (macAddr) {
            macEl.textContent = macAddr;
            registerMac(macAddr);
            logConsole('MAC detectada: ' + macAddr);
        }
      }
    } catch (e) {
      logConsole('Detección automática omitida: ' + e.message);
    }

    readLoop();
  } catch (e) {
    statusEl.textContent = 'Desconectado';
    logConsole('Error al conectar: ' + (e.message || e));
  }
});

copyMacBtn.addEventListener('click', async () => {
  if (macEl.textContent && macEl.textContent !== '—') {
    try {
      await navigator.clipboard.writeText(macEl.textContent);
      logConsole('MAC copiada: ' + macEl.textContent);
    } catch(e){ logConsole('Error al copiar.'); }
  }
});

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
    const ESP = window.esptool;
    if (!ESP) { logConsole('Librería esptool no cargada.'); return; }
    
    const resp = await fetch(path);
    if (!resp.ok) throw new Error('Archivo no encontrado: ' + path);
    const blob = await resp.arrayBuffer();

    const transport = new ESP.Transport(port);
    const esploader = new ESP.ESPLoader(transport, 115200);

    await esploader.main_fn();
    
    const fileArray = [{ data: new Uint8Array(blob), address: 0x1000 }];

    await esploader.write_flash({
        fileArray,
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (curr, total) => {
            if (curr % 100 === 0) logConsole(`Progreso: ${Math.round(curr/total*100)}%`);
        }
    });

    installCount++;
    localStorage.setItem(INSTALL_KEY, installCount);
    installCountEl.textContent = installCount;
    
    logConsole('¡Flasheo completado con éxito!');
    await esploader.hard_reset();
  } catch (e) {
    logConsole('Error de flasheo: ' + (e.message || e));
  }
}

flashMainBtn.addEventListener('click', () => flashFirmware('./firmware.bin', false));
flashTestBtn.addEventListener('click', () => flashFirmware('./diagnostico.bin', true));

window.addEventListener('beforeunload', async () => {
  keepReading = false;
  try {
    if (reader) await reader.cancel();
    if (port) await port.close();
  } catch(e){}
});

logConsole('AdolfitOS listo. Pulse "CONECTAR DISPOSITIVOo".');

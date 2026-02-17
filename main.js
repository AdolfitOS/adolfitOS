/**
 * esptool-js se carga como script clásico desde index.html, exponiendo window.esptool
 * para mantener compatibilidad con GitHub Pages y evitar errores de módulos.
 */

const els = {
  serialSupport: document.getElementById("serial-support"),
  connStatus: document.getElementById("connection-status"),
  chipModel: document.getElementById("chip-model"),
  macAddress: document.getElementById("mac-address"),
  localIdentified: document.getElementById("local-identified-count"),
  localInstall: document.getElementById("local-install-count"),
  globalCounter: document.getElementById("global-counter"),
  statusMessage: document.getElementById("status-message"),
  btnConnect: document.getElementById("btn-connect"),
  firmwareFile: document.getElementById("firmware-file"),
  btnInstall: document.getElementById("btn-install"),
  serialOutput: document.getElementById("serial-output"),
  serialInput: document.getElementById("serial-input"),
  btnSendSerial: document.getElementById("btn-send-serial"),
  btnClearLog: document.getElementById("btn-clear-log"),
  btnDownloadLog: document.getElementById("btn-download-log")
};

/* --- local counters (persistent) --- */

const LS_KEYS = {
  identified: "adolfitos_identified_devices",
  installs: "adolfitos_local_installs"
};

function loadLocalCounters() {
  const identified = parseInt(localStorage.getItem(LS_KEYS.identified) || "0", 10);
  const installs = parseInt(localStorage.getItem(LS_KEYS.installs) || "0", 10);
  els.localIdentified.textContent = identified;
  els.localInstall.textContent = installs;
}

function incLocalCounter(key, el) {
  const current = parseInt(localStorage.getItem(key) || "0", 10) + 1;
  localStorage.setItem(key, String(current));
  el.textContent = current;
}

/* --- global counter via countapi.xyz --- */

const COUNT_NAMESPACE = "adolfitos";
const COUNT_KEY = "instalaciones";

async function fetchGlobalCounter() {
  try {
    const res = await fetch(
      `https://api.countapi.xyz/get/${encodeURIComponent(COUNT_NAMESPACE)}/${encodeURIComponent(
        COUNT_KEY
      )}`
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const value = typeof data.value === "number" ? data.value : 0;
    setOdometer(value);
  } catch {
    setOdometer(0);
  }
}

async function incrementGlobalCounter() {
  try {
    const res = await fetch(
      `https://api.countapi.xyz/hit/${encodeURIComponent(COUNT_NAMESPACE)}/${encodeURIComponent(
        COUNT_KEY
      )}`
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const value = typeof data.value === "number" ? data.value : 0;
    setOdometer(value);
  } catch {
    // ignore
  }
}

function setOdometer(value) {
  const digits = String(Math.max(0, value)).padStart(6, "0").split("");
  const digitSpans = els.globalCounter.querySelectorAll(".digit");
  digitSpans.forEach((span, idx) => {
    span.textContent = digits[idx] || "0";
  });
}

/* --- serial + esptool-js state --- */

let port = null;
let reader = null;
let readLoopPromise = null;
let writer = null;
let esploader = null;
let logBuffer = "";

function setStatus(message, isError = false) {
  els.statusMessage.textContent = message;
  if (isError) {
    els.statusMessage.style.color = "#ff6688";
  } else {
    els.statusMessage.style.color = "var(--accent-strong)";
  }
}

function appendLogLine(line) {
  const div = document.createElement("div");
  div.className = "serial-output-line";
  div.textContent = line;
  els.serialOutput.appendChild(div);
  logBuffer += line + "\n";
  els.serialOutput.scrollTop = els.serialOutput.scrollHeight;
}

/* --- connect & identify --- */

async function connectDevice() {
  if (!("serial" in navigator)) {
    setStatus("Web Serial no está disponible en este navegador.", true);
    return;
  }

  try {
    if (port) {
      await disconnectDevice();
    }

    setStatus("Solicitando puerto serial...");
    port = await navigator.serial.requestPort({});
    await port.open({ baudRate: 115200 });

    const textEncoder = new TextEncoderStream();
    const writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
    writer = textEncoder.writable.getWriter();

    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();

    readLoopPromise = readSerialLoop(reader, readableStreamClosed, writableStreamClosed);
    updateConnectionUI(true);

    await initEsploader();
    await identifyChipAndMac();
  } catch (err) {
    console.error(err);
    setStatus("Error al conectar: " + (err.message || err), true);
    updateConnectionUI(false);
  }
}

async function disconnectDevice() {
  try {
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      reader = null;
    }
    if (port) {
      await port.close();
    }
  } catch {
    /* ignore */
  } finally {
    port = null;
    writer = null;
    esploader = null;
    updateConnectionUI(false);
  }
}

function updateConnectionUI(connected) {
  if (connected) {
    els.connStatus.textContent = "Conectado";
    els.connStatus.classList.remove("badge-disconnected");
    els.connStatus.classList.add("badge-connected");
    els.btnInstall.disabled = false;
    setStatus("Conectado. Identificando chip...");
  } else {
    els.connStatus.textContent = "Desconectado";
    els.connStatus.classList.add("badge-disconnected");
    els.connStatus.classList.remove("badge-connected");
    els.chipModel.textContent = "-";
    els.macAddress.textContent = "-";
    els.btnInstall.disabled = true;
  }
}

/* --- esptool-js integration --- */

async function initEsploader() {
  if (!window.esptool) {
    throw new Error("esptool-js no está disponible en window.esptool");
  }

  const logFn = (msg) => {
    if (typeof msg === "string") appendLogLine("[esptool] " + msg);
  };

  // La implementación exacta depende de esptool-js; esto sigue el patrón típico.
  // Se exige el uso de esploader.main_fn() para establecer compatibilidad.
  esploader = new window.esptool.ESPLoader({
    transport: {
      // Adaptador mínimo: esptool-js espera métodos send/receive; delegamos al writer/reader.
      write: async (data) => {
        if (!writer) throw new Error("Sin writer disponible");
        await writer.write(data);
      },
      read: async () => {
        // Para compatibilidad básica, la lectura la maneja esptool-js internamente;
        // aquí sólo devolvemos datos cuando el loader lo solicite.
        // La implementación real puede requerir mayor detalle según la versión.
        return new Uint8Array();
      }
    },
    baudrate: 115200,
    terminal: logFn
  });

  // main_fn típicamente hace sincronización/handshake
  await esploader.main_fn();
}

/* --- identificación chip + MAC --- */

async function identifyChipAndMac() {
  if (!esploader) {
    throw new Error("esploader no inicializado");
  }

  let chipName = esploader.chipName || esploader.get_chip_description?.() || "Desconocido";
  els.chipModel.textContent = String(chipName);

  let mac = "";
  try {
    if (typeof esploader.get_mac === "function") {
      mac = await esploader.get_mac();
    } else if (typeof esploader.read_mac === "function") {
      mac = await esploader.read_mac();
    }
  } catch {
    // reintento con read_mac si existe
    try {
      if (typeof esploader.read_mac === "function") {
        mac = await esploader.read_mac();
      }
    } catch (err2) {
      console.error("Error obteniendo MAC:", err2);
    }
  }

  if (!mac) {
    setStatus("No se pudo leer la MAC. Revisa la conexión.", true);
    els.macAddress.textContent = "-";
  } else {
    els.macAddress.textContent = String(mac);
    setStatus("Dispositivo identificado.");
    incLocalCounter(LS_KEYS.identified, els.localIdentified);
  }
}

/* --- flashing firmware --- */

async function installFirmware() {
  if (!port || !esploader) {
    setStatus("Conecta un dispositivo antes de instalar.", true);
    return;
  }

  const file = els.firmwareFile.files[0];
  if (!file) {
    setStatus("Selecciona un archivo firmware.bin.", true);
    return;
  }

  try {
    setStatus("Leyendo firmware...");
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);

    setStatus("Escribiendo firmware en el dispositivo...");
    appendLogLine(`[flasher] Iniciando write_flash, tamaño: ${data.length} bytes`);

    if (typeof esploader.write_flash === "function") {
      // API típica: write_flash(offset, data) o write_flash([{address, data}])
      if (esploader.write_flash.length === 2) {
        await esploader.write_flash(0x0, data);
      } else {
        await esploader.write_flash([{ address: 0x0, data }]);
      }
    } else {
      throw new Error("esploader.write_flash no está disponible");
    }

    setStatus("Instalación completada con éxito.");
    appendLogLine("[flasher] Firmware escrito correctamente.");
    incLocalCounter(LS_KEYS.installs, els.localInstall);
    await incrementGlobalCounter();
  } catch (err) {
    console.error(err);
    setStatus("Error durante instalación: " + (err.message || err), true);
    appendLogLine("[flasher] ERROR: " + (err.message || err));
  }
}

/* --- serial data loop --- */

async function readSerialLoop(readerInstance) {
  if (!readerInstance) return;
  try {
    for (;;) {
      const { value, done } = await readerInstance.read();
      if (done) break;
      if (value) {
        appendLogLine(String(value));
      }
    }
  } catch (err) {
    // cancelación o error
    console.error("Serial read error:", err);
  }
}

/* --- serial send --- */

async function sendSerialLine() {
  if (!writer) {
    setStatus("No hay dispositivo conectado para enviar datos.", true);
    return;
  }
  const text = els.serialInput.value;
  if (!text) return;
  try {
    const data = new TextEncoder().encode(text + "\r\n");
    await writer.write(data);
    els.serialInput.value = "";
  } catch (err) {
    console.error(err);
    setStatus("Error enviando datos serial.", true);
  }
}

/* --- log utilities --- */

function clearLog() {
  els.serialOutput.innerHTML = "";
  logBuffer = "";
}

function downloadLog() {
  const blob = new Blob([logBuffer || ""], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "adolfitos_serial_log.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* --- init UI --- */

function initSerialSupportLabel() {
  if ("serial" in navigator) {
    els.serialSupport.textContent = "OK";
    els.serialSupport.style.color = "#39ff14";
  } else {
    els.serialSupport.textContent = "No soportado";
    els.serialSupport.style.color = "#ff6688";
    setStatus("Este navegador no soporta Web Serial. Usa Chrome/Edge con HTTPS.", true);
  }
}

function initEvents() {
  els.btnConnect.addEventListener("click", () => {
    if (port) {
      disconnectDevice();
    } else {
      connectDevice();
    }
  });

  els.btnInstall.addEventListener("click", () => {
    installFirmware();
  });

  els.btnSendSerial.addEventListener("click", () => {
    sendSerialLine();
  });

  els.serialInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendSerialLine();
    }
  });

  els.btnClearLog.addEventListener("click", clearLog);
  els.btnDownloadLog.addEventListener("click", downloadLog);
}

/* --- boot --- */

loadLocalCounters();
fetchGlobalCounter();
initSerialSupportLabel();
initEvents();
setStatus("Listo.");
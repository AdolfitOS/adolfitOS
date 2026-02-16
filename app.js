// AdolfitOS - Sistema de Gestión de ESP32
let port;
let reader;
let esploader;
let transport;

// 1. FUNCIÓN DE CONEXIÓN E IDENTIFICACIÓN
async function conectarDispositivo() {
    const terminal = document.getElementById('console'); // ID corregido para tu HTML
    
    try {
        if (typeof window.esptool === 'undefined') {
            terminal.innerHTML += `<span style="color:red">[ERROR] La librería no cargó.</span>\n`;
            return;
        }

        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        
        terminal.innerHTML += `<span style="color:#39ff14">[SISTEMA] Sincronizando placa...</span>\n`;

        transport = new window.esptool.Transport(port);
        esploader = new window.esptool.ESPLoader(transport, 115200);

        await esploader.main_fn();

        const chipName = await esploader.chip.get_chip_description();
        const macAddr = await esploader.chip.read_mac();

        // Actualizar la interfaz con los IDs de tu HTML
        document.getElementById('chip-model').innerText = chipName;
        document.getElementById('mac-address').innerText = macAddr;
        document.getElementById('status').innerText = "Conectado";

        terminal.innerHTML += `<span style="color:#39ff14">[OK] ${chipName} detectado. MAC: ${macAddr}</span>\n`;

        leerMonitor();

    } catch (err) {
        terminal.innerHTML += `<span style="color:orange">[SISTEMA] Conexión cancelada.</span>\n`;
    }
}

// 2. FUNCIÓN DE MONITOREO SERIAL
async function leerMonitor() {
    const terminal = document.getElementById('console'); // ID corregido
    const textDecoder = new TextDecoder();

    while (port && port.readable) {
        reader = port.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                terminal.innerText += textDecoder.decode(value);
                terminal.scrollTop = terminal.scrollHeight;
            }
        } catch (error) {
            terminal.innerHTML += `\n[SISTEMA] Lectura pausada.\n`;
        } finally {
            reader.releaseLock();
        }
    }
}

// 3. FUNCIÓN DE FLASHEO
async function instalarFirmware() {
    const terminal = document.getElementById('console'); // ID corregido
    
    if (!esploader) {
        alert("Primero conecta el dispositivo");
        return;
    }

    try {
        terminal.innerHTML += `\n<span style="color:yellow">[FLASHEO] Descargando firmware.bin...</span>\n`;
        
        const response = await fetch('firmware.bin');
        if (!response.ok) throw new Error("Archivo .bin no encontrado en el servidor.");
        
        const contents = await response.arrayBuffer();
        const data = new Uint8Array(contents);

        await esploader.write_flash({
            fileArray: [{ data: data, address: 0x1000 }],
            flashSize: 'keep',
            flashMode: 'keep',
            flashFreq: 'keep',
            eraseAll: false,
            compress: true,
            reportProgress: (curr, total) => {
                const porcentaje = Math.round((curr / total) * 100);
                terminal.innerText = terminal.innerText.split('[PROGRESO]')[0] + `[PROGRESO] Instalando: ${porcentaje}%`;
            }
        });

        terminal.innerHTML += `\n<span style="color:#39ff14">[ÉXITO] AdolfitOS instalado correctamente.</span>\n`;
        await esploader.hard_reset();

    } catch (err) {
        terminal.innerHTML += `\n<span style="color:red">[ERROR] ${err.message}</span>\n`;
    }
}

// 4. VINCULACIÓN CON TUS IDs DE HTML (Corregido)
document.getElementById('connectBtn').onclick = conectarDispositivo;
document.getElementById('flashMain').onclick = instalarFirmware;

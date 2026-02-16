// AdolfitOS - Sistema de Gestión de ESP32
let port;
let reader;
let esploader;
let transport;

// 1. FUNCIÓN DE CONEXIÓN E IDENTIFICACIÓN
async function conectarDispositivo() {
    const terminal = document.getElementById('serial-output');
    
    try {
        // Verificación de la librería esptool-js
        if (typeof window.esptool === 'undefined') {
            terminal.innerHTML += `<span style="color:red">[ERROR] La librería de flasheo no cargó. Verifica tu conexión a internet e index.html</span>\n`;
            return;
        }

        // Solicitar puerto al usuario
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        
        terminal.innerHTML += `<span style="color:#39ff14">[SISTEMA] Puerto abierto. Sincronizando...</span>\n`;

        // Inicializar el transporte y el cargador
        transport = new window.esptool.Transport(port);
        esploader = new window.esptool.ESPLoader(transport, 115200);

        // Paso crítico: Sincronizar con el chip (Apretón de manos)
        await esploader.main_fn();

        // Extraer datos del hardware
        const chipName = await esploader.chip.get_chip_description();
        const macAddr = await esploader.chip.read_mac();

        // Actualizar la interfaz (Los campos que antes quedaban vacíos)
        document.getElementById('chip-model').innerText = chipName;
        document.getElementById('mac-address').innerText = macAddr;
        document.getElementById('status-text').innerText = "Conectado";

        terminal.innerHTML += `<span style="color:#39ff14">[OK] Detectado: ${chipName} | MAC: ${macAddr}</span>\n`;

        // Iniciar el monitor para recibir texto de la placa
        leerMonitor();

    } catch (err) {
        console.error(err);
        terminal.innerHTML += `<span style="color:orange">[SISTEMA] Error o Conexión cancelada: ${err.message}</span>\n`;
    }
}

// 2. FUNCIÓN DE MONITOREO SERIAL (LECTURA)
async function leerMonitor() {
    const terminal = document.getElementById('serial-output');
    const textDecoder = new TextDecoder();

    while (port && port.readable) {
        reader = port.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const deco = textDecoder.decode(value);
                terminal.innerText += deco;
                // Auto-scroll hacia abajo
                terminal.scrollTop = terminal.scrollHeight;
            }
        } catch (error) {
            terminal.innerHTML += `\n[SISTEMA] Lectura interrumpida.\n`;
        } finally {
            reader.releaseLock();
        }
    }
}

// 3. FUNCIÓN DE FLASHEO (INSTALAR ADOLFitos)
async function instalarFirmware() {
    const terminal = document.getElementById('serial-output');
    
    if (!esploader) {
        alert("Primero conecta tu ESP32");
        return;
    }

    try {
        terminal.innerHTML += `\n<span style="color:yellow">[FLASHEO] Descargando firmware.bin desde GitHub...</span>\n`;
        
        // Descarga el archivo .bin del mismo lugar donde está la web
        const response = await fetch('firmware.bin');
        if (!response.ok) throw new Error("No se encontró el archivo firmware.bin en el servidor.");
        
        const contents = await response.arrayBuffer();
        const data = new Uint8Array(contents);

        terminal.innerHTML += `[FLASHEO] Borrando y escribiendo... No desconectes la placa.\n`;

        // Proceso de escritura en la dirección 0x1000 (estándar ESP32)
        await esploader.write_flash({
            fileArray: [{ data: data, address: 0x1000 }],
            flashSize: 'keep',
            flashMode: 'keep',
            flashFreq: 'keep',
            eraseAll: false,
            compress: true,
            reportProgress: (curr, total) => {
                const porcentaje = Math.round((curr / total) * 100);
                // Actualizar línea de progreso en el monitor
                terminal.innerText = terminal.innerText.substring(0, terminal.innerText.lastIndexOf("[PROGRESO]")) + 
                                     `[PROGRESO] Instalando AdolfitOS: ${porcentaje}%`;
            }
        });

        terminal.innerHTML += `\n<span style="color:#39ff14">[ÉXITO] Instalación terminada. Reiniciando dispositivo...</span>\n`;
        
        // Reinicio automático de la placa
        await esploader.hard_reset();

    } catch (err) {
        terminal.innerHTML += `\n<span style="color:red">[ERROR] Fallo en el flasheo: ${err.message}</span>\n`;
    }
}

// 4. ASIGNACIÓN DE BOTONES (Asegúrate de que los IDs en el HTML coincidan)
document.getElementById('btn-conectar').addEventListener('click', conectarDispositivo);
document.querySelector('.btn-primary').addEventListener('click', instalarFirmware);

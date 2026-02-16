// AdolfitOS - Sistema de Gestión de ESP32
let port, esploader, transport;

async function conectarDispositivo() {
    const terminal = document.getElementById('console');
    
    // Verificamos si la librería ya cargó en el navegador
    if (typeof window.esptool === 'undefined') {
        terminal.innerHTML += `<span style="color:red">[ERROR] La librería externa aún no ha cargado. Reintenta en 2 segundos.</span>\n`;
        return;
    }

    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        
        terminal.innerHTML += `[SISTEMA] Puerto abierto. Sincronizando placa...\n`;

        transport = new window.esptool.Transport(port);
        esploader = new window.esptool.ESPLoader(transport, 115200);

        // handshake con el chip
        await esploader.main_fn();

        const chipName = await esploader.chip.get_chip_description();
        const macAddr = await esploader.chip.read_mac();

        // Actualizar la interfaz (Usando tus IDs originales)
        document.getElementById('chip-model').innerText = chipName;
        document.getElementById('mac-address').innerText = macAddr;
        document.getElementById('status').innerText = "Conectado";
        document.getElementById('status').style.color = "#39ff14";

        terminal.innerHTML += `[OK] Detectado: ${chipName} | MAC: ${macAddr}\n`;

        leerMonitor();

    } catch (err) {
        terminal.innerHTML += `<span style="color:orange">[SISTEMA] Error: ${err.message}</span>\n`;
    }
}

async function leerMonitor() {
    const terminal = document.getElementById('console');
    const textDecoder = new TextDecoder();

    while (port && port.readable) {
        const reader = port.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                terminal.innerText += textDecoder.decode(value);
                terminal.scrollTop = terminal.scrollHeight;
            }
        } catch (error) {
            break;
        } finally {
            reader.releaseLock();
        }
    }
}

// Vinculamos el botón al cargar el script
document.getElementById('connectBtn').onclick = conectarDispositivo;



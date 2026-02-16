// AdolfitOS - Sistema de Gestión de ESP32
let port, esploader, transport;

async function conectar() {
    const terminal = document.getElementById('serial-output');
    try {
        if (typeof window.esptool === 'undefined') {
            terminal.innerHTML += "Error: Librería no cargada.\n";
            return;
        }

        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        
        terminal.innerHTML += "Conectado al puerto. Sincronizando...\n";

        transport = new window.esptool.Transport(port);
        esploader = new window.esptool.ESPLoader(transport, 115200);
        await esploader.main_fn();

        // Identificación
        const chip = await esploader.chip.get_chip_description();
        const mac = await esploader.chip.read_mac();

        document.getElementById('chip-model').innerText = chip;
        document.getElementById('mac-address').innerText = mac;
        document.getElementById('status-text').innerText = "Conectado";
        document.getElementById('status-text').style.color = "#39ff14";

        terminal.innerHTML += `Detectado: ${chip} | MAC: ${mac}\n`;
        leer();

    } catch (e) {
        terminal.innerHTML += "Error de conexión o cancelado.\n";
    }
}

async function leer() {
    const terminal = document.getElementById('serial-output');
    const decoder = new TextDecoder();
    while (port && port.readable) {
        const reader = port.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                terminal.innerText += decoder.decode(value);
                terminal.scrollTop = terminal.scrollHeight;
            }
        } finally { reader.releaseLock(); }
    }
}

// Vincular botones con los IDs del nuevo HTML
document.getElementById('btn-conectar').onclick = conectar;


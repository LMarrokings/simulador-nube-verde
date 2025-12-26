import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loginSimulador } from './src/auth.js';
import { obtenerPuntos } from './src/obtenerPuntos.js';
import { generarLectura } from './src/generador.js';
import { enviarLectura, formatearLecturaLog } from './src/envio.js';
import { CONFIG, validarConfiguracion, parsearFecha } from './config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

// Estado global del simulador
let simuladorState = {
    corriendo: false,
    autenticado: false,
    puntos: [],
    lecturas: [],
    totalEnviadas: 0,
    ultimaLectura: null,
    intervalo: null,
    config: { ...CONFIG }
};

// Servir archivos estáticos
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// API endpoints
app.get('/api/status', (req, res) => {
    res.json({
        corriendo: simuladorState.corriendo,
        autenticado: simuladorState.autenticado,
        totalEnviadas: simuladorState.totalEnviadas,
        puntosCount: simuladorState.puntos.length,
        config: simuladorState.config
    });
});

app.get('/api/puntos', (req, res) => {
    res.json(simuladorState.puntos);
});

app.get('/api/lecturas', (req, res) => {
    res.json(simuladorState.lecturas.slice(-50)); // Últimas 50
});

app.post('/api/config', (req, res) => {
    const { intervalo, fechaInicio, fechaFin, simularPicos, factorPico, factorFinSemana } = req.body;
    
    if (intervalo) simuladorState.config.INTERVALO_MS = intervalo * 1000;
    if (fechaInicio !== undefined) simuladorState.config.FECHA_INICIO = fechaInicio || null;
    if (fechaFin !== undefined) simuladorState.config.FECHA_FIN = fechaFin || null;
    if (simularPicos !== undefined) simuladorState.config.SIMULAR_PICOS = simularPicos;
    if (factorPico) simuladorState.config.FACTOR_PICO = factorPico;
    if (factorFinSemana) simuladorState.config.FACTOR_FIN_SEMANA = factorFinSemana;
    
    io.emit('config-updated', simuladorState.config);
    res.json({ success: true, config: simuladorState.config });
});

app.post('/api/iniciar', async (req, res) => {
    if (simuladorState.corriendo) {
        return res.json({ success: false, message: 'El simulador ya está corriendo' });
    }
    
    try {
        // Autenticar si no lo está
        if (!simuladorState.autenticado) {
            await loginSimulador();
            simuladorState.autenticado = true;
            io.emit('log', { tipo: 'success', mensaje: '✅ Autenticado con Firebase' });
        }
        
        // Obtener puntos
        simuladorState.puntos = await obtenerPuntos();
        io.emit('log', { tipo: 'info', mensaje: `📍 ${simuladorState.puntos.length} puntos cargados` });
        io.emit('puntos', simuladorState.puntos);
        
        // Determinar modo
        const modo = simuladorState.config.FECHA_INICIO ? 'historico' : 'tiempo_real';
        
        if (modo === 'historico') {
            iniciarModoHistorico();
        } else {
            iniciarModoTiempoReal();
        }
        
        simuladorState.corriendo = true;
        io.emit('status', { corriendo: true, modo });
        res.json({ success: true, modo });
        
    } catch (error) {
        io.emit('log', { tipo: 'error', mensaje: `❌ Error: ${error.message}` });
        res.json({ success: false, message: error.message });
    }
});

app.post('/api/detener', (req, res) => {
    detenerSimulador();
    res.json({ success: true });
});

// Funciones del simulador
function iniciarModoTiempoReal() {
    io.emit('log', { tipo: 'info', mensaje: `🕐 Modo TIEMPO REAL - Intervalo: ${simuladorState.config.INTERVALO_MS / 1000}s` });
    
    // Ejecutar inmediatamente
    ejecutarCiclo(new Date());
    
    // Configurar intervalo
    simuladorState.intervalo = setInterval(() => {
        ejecutarCiclo(new Date());
    }, simuladorState.config.INTERVALO_MS);
}

async function iniciarModoHistorico() {
    io.emit('log', { tipo: 'info', mensaje: '📅 Modo HISTÓRICO iniciado' });
    
    const fechaInicio = parsearFecha(simuladorState.config.FECHA_INICIO);
    const fechaFin = parsearFecha(simuladorState.config.FECHA_FIN) || new Date();
    const incremento = simuladorState.config.INCREMENTO_TIEMPO_MS || 3600000;
    
    io.emit('log', { tipo: 'info', mensaje: `   Desde: ${fechaInicio.toLocaleString()}` });
    io.emit('log', { tipo: 'info', mensaje: `   Hasta: ${fechaFin.toLocaleString()}` });
    
    let fechaActual = new Date(fechaInicio);
    let lote = 0;
    
    const procesarLote = async () => {
        if (!simuladorState.corriendo || fechaActual > fechaFin) {
            io.emit('log', { tipo: 'success', mensaje: `✅ Simulación histórica completada. Total: ${simuladorState.totalEnviadas}` });
            detenerSimulador();
            return;
        }
        
        lote++;
        await ejecutarCiclo(new Date(fechaActual));
        fechaActual = new Date(fechaActual.getTime() + incremento);
        
        // Pequeña pausa para no saturar
        setTimeout(procesarLote, 100);
    };
    
    procesarLote();
}

async function ejecutarCiclo(fecha) {
    const lecturasLote = [];
    
    for (const punto of simuladorState.puntos) {
        try {
            const lectura = generarLectura(punto, fecha);
            await enviarLectura(lectura);
            
            lecturasLote.push({
                ...lectura,
                fechaFormateada: fecha.toLocaleString('es-SV'),
                nombrePunto: punto.nombre
            });
            
            simuladorState.totalEnviadas++;
            
        } catch (error) {
            io.emit('log', { tipo: 'error', mensaje: `❌ Error en ${punto.id}: ${error.message}` });
        }
    }
    
    // Guardar últimas lecturas
    simuladorState.lecturas = [...lecturasLote, ...simuladorState.lecturas].slice(0, 100);
    simuladorState.ultimaLectura = new Date();
    
    // Emitir a clientes
    io.emit('lecturas', lecturasLote);
    io.emit('stats', {
        totalEnviadas: simuladorState.totalEnviadas,
        ultimaLectura: simuladorState.ultimaLectura
    });
}

function detenerSimulador() {
    if (simuladorState.intervalo) {
        clearInterval(simuladorState.intervalo);
        simuladorState.intervalo = null;
    }
    simuladorState.corriendo = false;
    io.emit('status', { corriendo: false });
    io.emit('log', { tipo: 'warning', mensaje: '⏹️ Simulador detenido' });
}

// Socket.IO conexiones
io.on('connection', (socket) => {
    console.log('🔌 Cliente conectado');
    
    // Enviar estado actual
    socket.emit('status', { 
        corriendo: simuladorState.corriendo,
        autenticado: simuladorState.autenticado
    });
    socket.emit('stats', {
        totalEnviadas: simuladorState.totalEnviadas,
        ultimaLectura: simuladorState.ultimaLectura
    });
    socket.emit('config-updated', simuladorState.config);
    
    if (simuladorState.puntos.length > 0) {
        socket.emit('puntos', simuladorState.puntos);
    }
    
    socket.on('disconnect', () => {
        console.log('🔌 Cliente desconectado');
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
🌿 ════════════════════════════════════════════════════
🌿   SIMULADOR NUBE VERDE - Interfaz Web
🌿   Abre tu navegador en: http://localhost:${PORT}
🌿 ════════════════════════════════════════════════════
    `);
});

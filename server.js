import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from './src/firebase.js';
import { obtenerPuntos } from './src/obtenerPuntos.js';
import { generarLectura } from './src/generador.js';
import { enviarLectura } from './src/envio.js';
import { CONFIG, parsearFecha } from './config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

// Estado global del simulador
let simuladorState = {
    corriendo: false,
    autenticado: false,
    usuarioEmail: null,
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

// ============================================
// API: LOGIN CON FIREBASE AUTH
// ============================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Email y contraseña son requeridos' 
        });
    }
    
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        simuladorState.autenticado = true;
        simuladorState.usuarioEmail = user.email;
        
        io.emit('log', { tipo: 'success', mensaje: `✅ Login exitoso: ${user.email}` });
        io.emit('auth-status', { 
            autenticado: true, 
            email: user.email 
        });
        
        console.log(`✅ Usuario autenticado: ${user.email}`);
        
        res.json({ 
            success: true, 
            email: user.email,
            message: 'Autenticación exitosa'
        });
        
    } catch (error) {
        console.error('❌ Error de login:', error.code);
        
        let mensaje = 'Error de autenticación';
        switch (error.code) {
            case 'auth/invalid-email':
                mensaje = 'El correo electrónico no es válido';
                break;
            case 'auth/user-not-found':
                mensaje = 'No existe una cuenta con este correo';
                break;
            case 'auth/wrong-password':
                mensaje = 'Contraseña incorrecta';
                break;
            case 'auth/invalid-credential':
                mensaje = 'Credenciales inválidas';
                break;
            case 'auth/too-many-requests':
                mensaje = 'Demasiados intentos. Intenta más tarde';
                break;
            default:
                mensaje = error.message;
        }
        
        io.emit('log', { tipo: 'error', mensaje: `❌ Login fallido: ${mensaje}` });
        
        res.status(401).json({ 
            success: false, 
            message: mensaje 
        });
    }
});

app.post('/api/logout', (req, res) => {
    simuladorState.autenticado = false;
    simuladorState.usuarioEmail = null;
    
    // Detener simulador si está corriendo
    if (simuladorState.corriendo) {
        detenerSimulador();
    }
    
    io.emit('auth-status', { autenticado: false, email: null });
    io.emit('log', { tipo: 'info', mensaje: '👋 Sesión cerrada' });
    
    res.json({ success: true });
});

app.get('/api/auth-status', (req, res) => {
    res.json({
        autenticado: simuladorState.autenticado,
        email: simuladorState.usuarioEmail
    });
});

// ============================================
// API: ESTADO Y CONFIGURACIÓN
// ============================================
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

// ============================================
// API: TOGGLE PUNTO (ENCENDER/APAGAR)
// ============================================
app.post('/api/puntos/:id/toggle', async (req, res) => {
    // Verificar autenticación
    if (!simuladorState.autenticado) {
        return res.status(401).json({ 
            success: false, 
            message: 'Debes iniciar sesión primero' 
        });
    }
    
    const puntoId = req.params.id;
    
    try {
        // Buscar el punto en el estado local
        const punto = simuladorState.puntos.find(p => p.id === puntoId);
        
        if (!punto) {
            return res.status(404).json({ 
                success: false, 
                message: 'Punto no encontrado' 
            });
        }
        
        // Nuevo estado (toggle)
        const nuevoEstado = !punto.activo;
        
        // Actualizar en Firestore
        const puntoRef = doc(db, 'puntos_monitoreo', punto.docId);
        await updateDoc(puntoRef, { activo: nuevoEstado });
        
        // Actualizar estado local
        punto.activo = nuevoEstado;
        
        // Notificar a todos los clientes
        io.emit('punto-actualizado', { id: puntoId, activo: nuevoEstado });
        io.emit('puntos', simuladorState.puntos);
        io.emit('log', { 
            tipo: nuevoEstado ? 'success' : 'warning', 
            mensaje: `${nuevoEstado ? '🟢' : '⚫'} Punto ${puntoId} ${nuevoEstado ? 'ACTIVADO' : 'DESACTIVADO'}` 
        });
        
        console.log(`${nuevoEstado ? '🟢' : '⚫'} Punto ${puntoId} → ${nuevoEstado ? 'activo' : 'inactivo'}`);
        
        res.json({ 
            success: true, 
            id: puntoId, 
            activo: nuevoEstado 
        });
        
    } catch (error) {
        console.error('❌ Error actualizando punto:', error);
        io.emit('log', { tipo: 'error', mensaje: `❌ Error al actualizar ${puntoId}: ${error.message}` });
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Endpoint para actualizar múltiples puntos a la vez
app.post('/api/puntos/toggle-all', async (req, res) => {
    if (!simuladorState.autenticado) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    
    const { activo } = req.body; // true = activar todos, false = desactivar todos
    
    try {
        for (const punto of simuladorState.puntos) {
            const puntoRef = doc(db, 'puntos_monitoreo', punto.docId);
            await updateDoc(puntoRef, { activo: activo });
            punto.activo = activo;
        }
        
        io.emit('puntos', simuladorState.puntos);
        io.emit('log', { 
            tipo: activo ? 'success' : 'warning', 
            mensaje: `${activo ? '🟢' : '⚫'} Todos los puntos ${activo ? 'ACTIVADOS' : 'DESACTIVADOS'}` 
        });
        
        res.json({ success: true, activo });
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
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
    // Verificar autenticación
    if (!simuladorState.autenticado) {
        return res.status(401).json({ 
            success: false, 
            message: 'Debes iniciar sesión primero' 
        });
    }
    
    if (simuladorState.corriendo) {
        return res.json({ success: false, message: 'El simulador ya está corriendo' });
    }
    
    try {
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
    
    // Enviar estado de autenticación
    socket.emit('auth-status', {
        autenticado: simuladorState.autenticado,
        email: simuladorState.usuarioEmail
    });
    
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

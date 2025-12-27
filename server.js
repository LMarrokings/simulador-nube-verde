import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, updateDoc, collection, getDocs, limit, query } from 'firebase/firestore';
import { auth, db } from './src/firebase.js';
import { obtenerPuntos } from './src/obtenerPuntos.js';
import { generarLectura } from './src/generador.js';
import { enviarLectura } from './src/envio.js';
import { CONFIG, parsearFecha as parsearFechaOriginal } from './config/config.js';

// ============================================
// FUNCIÓN MEJORADA PARA PARSEAR FECHAS
// ============================================
function parsearFecha(fechaStr) {
  if (!fechaStr) return null;
  
  // Si ya es un objeto Date, devolverlo
  if (fechaStr instanceof Date) return fechaStr;
  
  // Convertir a string por si acaso
  fechaStr = String(fechaStr).trim();
  
  // Si está vacío después de trim, retornar null
  if (!fechaStr) return null;
  
  // Reemplazar espacio por T para ISO 8601
  const fechaISO = fechaStr.replace(" ", "T");
  
  // Crear fecha
  const fecha = new Date(fechaISO);
  
  // Validar que la fecha es válida
  if (isNaN(fecha.getTime())) {
    console.error('❌ Error parseando fecha:', fechaStr);
    return null;
  }
  
  return fecha;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

// ============================================
// MEJORA 1: Sistema de sesiones por socket
// ============================================
const sesiones = new Map(); // socketId -> { autenticado, email, puntos }

// ============================================
// MEJORA 2: Estado del servidor
// ============================================
let connectedClients = 0;
const serverStartTime = Date.now();

// Estado global del simulador (compartido entre sesiones autenticadas)
let simuladorState = {
    corriendo: false,
    puntos: [],
    lecturas: [],
    totalEnviadas: 0,
    ultimaLectura: null,
    intervalo: null,
    config: { ...CONFIG }
};

// ============================================
// MEJORA 3: Health check de Firebase
// ============================================
let firebaseHealthy = true;
let lastFirebaseCheck = Date.now();

async function checkFirebaseHealth() {
    // Solo hacer health check si hay un usuario autenticado
    if (!auth.currentUser) {
        return;
    }
    
    try {
        const testQuery = query(collection(db, 'puntos_monitoreo'), limit(1));
        await getDocs(testQuery);
        
        if (!firebaseHealthy) {
            firebaseHealthy = true;
            io.emit('firebase-status', { healthy: true });
            io.emit('log', { tipo: 'success', mensaje: 'âœ… ConexiÃ³n a Firebase restaurada' });
            console.log('âœ… Firebase connection restored');
        }
        lastFirebaseCheck = Date.now();
    } catch (error) {
        if (firebaseHealthy) {
            firebaseHealthy = false;
            io.emit('firebase-status', { healthy: false });
            io.emit('log', { tipo: 'error', mensaje: 'âŒ Sin conexiÃ³n a Firebase' });
            console.error('âŒ Firebase connection lost:', error.message);
        }
    }
}

// Verificar salud de Firebase cada 30 segundos (solo si hay autenticación)
setInterval(checkFirebaseHealth, 30000);

// Servir archivos estÃ¡ticos
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// ============================================
// API: LOGIN CON FIREBASE AUTH (MEJORADO)
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
        
        // MEJORA: Cargar puntos automáticamente en login
        const puntos = await obtenerPuntos();
        
        // Guardar en sesión global (temporal - mejorar con sessions reales)
        simuladorState.puntos = puntos;
        
        io.emit('log', { tipo: 'success', mensaje: `✅ Login exitoso: ${user.email}` });
        io.emit('auth-status', { 
            autenticado: true, 
            email: user.email 
        });
        
        // MEJORA: Emitir puntos inmediatamente
        io.emit('puntos', puntos);
        io.emit('log', { tipo: 'info', mensaje: `📍 ${puntos.length} puntos cargados` });
        
        console.log(`✅ Usuario autenticado: ${user.email}`);
        console.log(`📍 ${puntos.length} puntos cargados automáticamente`);
        
        res.json({ 
            success: true, 
            email: user.email,
            message: 'Autenticación exitosa',
            puntosCount: puntos.length
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

app.post('/api/logout', async (req, res) => {
    try {
        await signOut(auth);
        
        // Detener simulador si está corriendo
        if (simuladorState.corriendo) {
            detenerSimulador();
        }
        
        io.emit('auth-status', { autenticado: false, email: null });
        io.emit('log', { tipo: 'info', mensaje: '👋 Sesión cerrada' });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/auth-status', (req, res) => {
    const user = auth.currentUser;
    res.json({
        autenticado: !!user,
        email: user?.email || null
    });
});

// ============================================
// API: ESTADO Y CONFIGURACIÓN
// ============================================
app.get('/api/status', (req, res) => {
    res.json({
        corriendo: simuladorState.corriendo,
        autenticado: !!auth.currentUser,
        totalEnviadas: simuladorState.totalEnviadas,
        puntosCount: simuladorState.puntos.length,
        config: simuladorState.config
    });
});

app.get('/api/puntos', (req, res) => {
    res.json(simuladorState.puntos);
});

// ============================================
// MEJORA 4: Endpoint de stats del servidor
// ============================================
app.get('/api/server-stats', (req, res) => {
    const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
    const memoryUsage = process.memoryUsage();
    
    res.json({
        uptime,
        connectedClients,
        firebaseHealthy,
        lastFirebaseCheck: new Date(lastFirebaseCheck).toISOString(),
        memory: {
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            rss: Math.round(memoryUsage.rss / 1024 / 1024)
        }
    });
});

// ============================================
// API: TOGGLE PUNTO (ENCENDER/APAGAR)
// ============================================
app.post('/api/puntos/:id/toggle', async (req, res) => {
    if (!auth.currentUser) {
        return res.status(401).json({ 
            success: false, 
            message: 'Debes iniciar sesión primero' 
        });
    }
    
    const puntoId = req.params.id;
    
    try {
        const punto = simuladorState.puntos.find(p => p.id === puntoId);
        
        if (!punto) {
            return res.status(404).json({ 
                success: false, 
                message: 'Punto no encontrado' 
            });
        }
        
        const nuevoEstado = !punto.activo;
        
        const puntoRef = doc(db, 'puntos_monitoreo', punto.docId);
        await updateDoc(puntoRef, { activo: nuevoEstado });
        
        punto.activo = nuevoEstado;
        
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

app.post('/api/puntos/toggle-all', async (req, res) => {
    if (!auth.currentUser) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    
    const { activo } = req.body;
    
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
    res.json(simuladorState.lecturas.slice(-50));
});

// ============================================
// MEJORA 5: Validación de configuración
// ============================================
app.post('/api/config', (req, res) => {
    const { intervalo, fechaInicio, fechaFin, simularPicos, factorPico, factorFinSemana } = req.body;
    
    // Validaciones
    const errores = [];
    
    if (fechaInicio && fechaFin) {
        // Convertir formato datetime-local a formato esperado
        const inicio = fechaInicio.replace('T', ' ') + ':00';
        const fin = fechaFin.replace('T', ' ') + ':00';
        
        const fechaInicioDate = parsearFecha(inicio);
        const fechaFinDate = parsearFecha(fin);
        
        if (fechaInicioDate >= fechaFinDate) {
            errores.push('La fecha de inicio debe ser anterior a la fecha de fin');
        }
        
        // Calcular total de lecturas estimadas
        const diff = fechaFinDate.getTime() - fechaInicioDate.getTime();
        const incremento = simuladorState.config.INCREMENTO_TIEMPO_MS || 3600000;
        const totalLotes = Math.ceil(diff / incremento);
        const totalLecturas = totalLotes * simuladorState.puntos.length;
        
        if (totalLecturas > 10000) {
            errores.push(`Se generarían aproximadamente ${totalLecturas} lecturas. Considera reducir el rango de fechas.`);
        }
        
        simuladorState.config.FECHA_INICIO = inicio;
        simuladorState.config.FECHA_FIN = fin;
    }
    
    if (intervalo) {
        if (intervalo < 5) {
            errores.push('El intervalo mínimo es de 5 segundos');
        }
        simuladorState.config.INTERVALO_MS = intervalo * 1000;
    }
    
    if (fechaInicio !== undefined && !fechaFin) {
        simuladorState.config.FECHA_INICIO = fechaInicio ? fechaInicio.replace('T', ' ') + ':00' : null;
    }
    
    if (fechaFin !== undefined && !fechaInicio) {
        simuladorState.config.FECHA_FIN = fechaFin ? fechaFin.replace('T', ' ') + ':00' : null;
    }
    
    if (simularPicos !== undefined) simuladorState.config.SIMULAR_PICOS = simularPicos;
    if (factorPico) simuladorState.config.FACTOR_PICO = factorPico;
    if (factorFinSemana) simuladorState.config.FACTOR_FIN_SEMANA = factorFinSemana;
    
    if (errores.length > 0) {
        return res.status(400).json({ 
            success: false, 
            errores,
            config: simuladorState.config 
        });
    }
    
    io.emit('config-updated', simuladorState.config);
    res.json({ success: true, config: simuladorState.config });
});

app.post('/api/iniciar', async (req, res) => {
    if (!auth.currentUser) {
        return res.status(401).json({ 
            success: false, 
            message: 'Debes iniciar sesión primero' 
        });
    }
    
    if (simuladorState.corriendo) {
        return res.json({ success: false, message: 'El simulador ya está corriendo' });
    }
    
    try {
        // MEJORA: Solo re-obtener puntos si no están cargados
        if (simuladorState.puntos.length === 0) {
            simuladorState.puntos = await obtenerPuntos();
            io.emit('log', { tipo: 'info', mensaje: `📍 ${simuladorState.puntos.length} puntos cargados` });
            io.emit('puntos', simuladorState.puntos);
        }
        
        const modo = simuladorState.config.FECHA_INICIO ? 'historico' : 'tiempo_real';
        
        // IMPORTANTE: Establecer corriendo=true ANTES de iniciar los modos
        // para evitar race condition en modo histórico
        simuladorState.corriendo = true;
        io.emit('status', { corriendo: true, modo });
        
        if (modo === 'historico') {
            iniciarModoHistorico();
        } else {
            iniciarModoTiempoReal();
        }
        
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
    
    ejecutarCiclo(new Date());
    
    simuladorState.intervalo = setInterval(() => {
        ejecutarCiclo(new Date());
    }, simuladorState.config.INTERVALO_MS);
}

// ============================================
// MEJORA 6: Modo histórico mejorado con progreso
// ============================================
async function iniciarModoHistorico() {
    io.emit('log', { tipo: 'info', mensaje: '📅 Modo HISTÓRICO iniciado' });
    
    const fechaInicio = parsearFecha(simuladorState.config.FECHA_INICIO);
    const fechaFin = parsearFecha(simuladorState.config.FECHA_FIN) || new Date();
    const incremento = simuladorState.config.INCREMENTO_TIEMPO_MS || 3600000;
    
    // Calcular total de lotes
    const diff = fechaFin.getTime() - fechaInicio.getTime();
    const totalLotes = Math.ceil(diff / incremento);
    const totalLecturasEstimadas = totalLotes * simuladorState.puntos.length;
    
    io.emit('log', { tipo: 'info', mensaje: `   Desde: ${fechaInicio.toLocaleString('es-SV')}` });
    io.emit('log', { tipo: 'info', mensaje: `   Hasta: ${fechaFin.toLocaleString('es-SV')}` });
    io.emit('log', { tipo: 'info', mensaje: `   Total de lotes estimados: ${totalLotes}` });
    io.emit('log', { tipo: 'info', mensaje: `   Lecturas estimadas: ~${totalLecturasEstimadas}` });
    
    let fechaActual = new Date(fechaInicio);
    let lote = 0;
    
    const procesarLote = async () => {
        if (!simuladorState.corriendo || fechaActual > fechaFin) {
            io.emit('log', { tipo: 'success', mensaje: `✅ Simulación histórica completada. Total: ${simuladorState.totalEnviadas}` });
            detenerSimulador();
            return;
        }
        
        lote++;
        
        // Log de progreso cada 10 lotes o si es el primero
        if (lote === 1 || lote % 10 === 0) {
            const progreso = ((lote / totalLotes) * 100).toFixed(1);
            io.emit('log', { 
                tipo: 'info', 
                mensaje: `📦 Procesando lote ${lote}/${totalLotes} (${progreso}%) - ${fechaActual.toLocaleString('es-SV')}` 
            });
        }
        
        await ejecutarCiclo(new Date(fechaActual));
        fechaActual = new Date(fechaActual.getTime() + incremento);
        
        // Emitir progreso
        io.emit('historico-progreso', {
            loteActual: lote,
            totalLotes,
            progreso: ((lote / totalLotes) * 100).toFixed(1),
            fechaActual: fechaActual.toISOString()
        });
        
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
    
    simuladorState.lecturas = [...lecturasLote, ...simuladorState.lecturas].slice(0, 100);
    simuladorState.ultimaLectura = new Date();
    
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
    io.emit('log', { tipo: 'warning', mensaje: 'ℹ️ Simulador detenido' });
}

// ============================================
// MEJORA 7: Socket.IO mejorado con stats
// ============================================
io.on('connection', (socket) => {
    connectedClients++;
    console.log(`📌 Cliente conectado (Total: ${connectedClients})`);
    
    // Emitir estado de autenticación
    const user = auth.currentUser;
    socket.emit('auth-status', {
        autenticado: !!user,
        email: user?.email || null
    });
    
    // Emitir estado actual
    socket.emit('status', { 
        corriendo: simuladorState.corriendo,
        autenticado: !!user
    });
    
    socket.emit('stats', {
        totalEnviadas: simuladorState.totalEnviadas,
        ultimaLectura: simuladorState.ultimaLectura
    });
    
    socket.emit('config-updated', simuladorState.config);
    
    // Emitir puntos si existen
    if (simuladorState.puntos.length > 0) {
        socket.emit('puntos', simuladorState.puntos);
    }
    
    // Emitir estado de Firebase
    socket.emit('firebase-status', { healthy: firebaseHealthy });
    
    // Emitir stats del servidor
    io.emit('server-stats', { 
        usuarios: connectedClients,
        uptime: Math.floor((Date.now() - serverStartTime) / 1000)
    });
    
    socket.on('disconnect', () => {
        connectedClients--;
        console.log(`📌 Cliente desconectado (Total: ${connectedClients})`);
        io.emit('server-stats', { 
            usuarios: connectedClients,
            uptime: Math.floor((Date.now() - serverStartTime) / 1000)
        });
    });
});

// Iniciar servidor con manejo de puerto ocupado
let PORT = process.env.PORT || 3000;

function iniciarServidor(puerto) {
    server.listen(puerto)
        .on('listening', () => {
            console.log(`
🌿 ═══════════════════════════════════════════════════════════
🌿   SIMULADOR NUBE VERDE - Interfaz Web (MEJORADO)
🌿   Abre tu navegador en: http://localhost:${puerto}
🌿 ═══════════════════════════════════════════════════════════
            `);
        })
        .on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`⚠️  Puerto ${puerto} ocupado. Intentando puerto ${puerto + 1}...`);
                iniciarServidor(puerto + 1);
            } else {
                console.error('❌ Error al iniciar servidor:', err);
                process.exit(1);
            }
        });
}

iniciarServidor(PORT);

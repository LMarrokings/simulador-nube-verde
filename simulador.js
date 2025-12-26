import { loginSimulador } from "./src/auth.js";
import { obtenerPuntos } from "./src/obtenerPuntos.js";
import { generarLectura, debugLectura } from "./src/generador.js";
import { enviarLectura, formatearLecturaLog } from "./src/envio.js";
import { CONFIG, validarConfiguracion, mostrarConfiguracion, parsearFecha } from "./config/config.js";

// ============================================
// SIMULADOR NUBE VERDE - ORQUESTADOR PRINCIPAL
// ============================================

/**
 * Ejecuta el simulador en modo TIEMPO REAL
 * Genera lecturas con la fecha actual cada INTERVALO_MS
 */
async function ejecutarTiempoReal(puntos) {
  console.log("🕐 Modo: TIEMPO REAL");
  console.log(`📡 Enviando lecturas cada ${CONFIG.INTERVALO_MS / 1000} segundos...\n`);

  // Primera ejecución inmediata
  await cicloLecturas(puntos, new Date());

  // Ejecuciones periódicas
  setInterval(async () => {
    await cicloLecturas(puntos, new Date());
  }, CONFIG.INTERVALO_MS);
}

/**
 * Ejecuta el simulador en modo HISTÓRICO
 * Genera lecturas desde FECHA_INICIO hasta FECHA_FIN
 */
async function ejecutarHistorico(puntos) {
  console.log("📅 Modo: HISTÓRICO");
  
  const fechaInicio = parsearFecha(CONFIG.FECHA_INICIO);
  const fechaFin = parsearFecha(CONFIG.FECHA_FIN) || new Date();
  
  console.log(`   Desde: ${fechaInicio.toLocaleString('es-SV')}`);
  console.log(`   Hasta: ${fechaFin.toLocaleString('es-SV')}`);
  console.log(`   Incremento: ${CONFIG.INCREMENTO_TIEMPO_MS / 60000} minutos\n`);

  let fechaActual = new Date(fechaInicio);
  let totalLecturas = 0;
  let lote = 0;

  while (fechaActual <= fechaFin) {
    lote++;
    console.log(`\n📦 Lote ${lote} - ${fechaActual.toLocaleString('es-SV')}`);
    
    for (const punto of puntos) {
      const lectura = generarLectura(punto, new Date(fechaActual));
      await enviarLectura(lectura);
      console.log(`   ${formatearLecturaLog(lectura)}`);
      totalLecturas++;
    }

    // Avanzar el tiempo simulado
    fechaActual = new Date(fechaActual.getTime() + CONFIG.INCREMENTO_TIEMPO_MS);

    // Delay entre lotes para no saturar Firestore
    if (lote % CONFIG.BATCH_SIZE === 0) {
      console.log(`   ⏳ Pausa de ${CONFIG.DELAY_ENTRE_LOTES}ms...`);
      await delay(CONFIG.DELAY_ENTRE_LOTES);
    }
  }

  console.log("\n" + "═".repeat(50));
  console.log(`✅ Simulación histórica completada`);
  console.log(`   Total de lecturas: ${totalLecturas}`);
  console.log(`   Puntos procesados: ${puntos.length}`);
  console.log("═".repeat(50));
  
  process.exit(0);
}

/**
 * Ejecuta un ciclo de lecturas para todos los puntos
 */
async function cicloLecturas(puntos, fecha) {
  const timestamp = fecha.toLocaleString('es-SV', { timeZone: 'America/El_Salvador' });
  console.log(`\n🔄 [${timestamp}]`);
  
  for (const punto of puntos) {
    try {
      const lectura = generarLectura(punto, fecha);
      await enviarLectura(lectura);
      console.log(`   ${formatearLecturaLog(lectura)}`);
    } catch (err) {
      console.error(`   ❌ Error en ${punto.id}: ${err.message}`);
    }
  }
}

/**
 * Función auxiliar para delays
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Muestra información de los puntos cargados
 */
function mostrarPuntos(puntos) {
  console.log("\n📍 Puntos de monitoreo cargados:");
  console.log("─".repeat(60));
  
  for (const p of puntos) {
    const estado = p.activo ? "🟢 Activo" : "⚫ Inactivo";
    console.log(`   ${p.id.padEnd(8)} | ${p.nombre.padEnd(25)} | ${estado}`);
    console.log(`            | Base: ${p.consumo_base_kwh} kWh | ${p.potencia_base_w} W`);
  }
  
  console.log("─".repeat(60));
}

// ============================================
// INICIO DEL SIMULADOR
// ============================================

async function iniciar() {
  console.clear();
  console.log("🌿 ═══════════════════════════════════════════════════");
  console.log("🌿       SIMULADOR NUBE VERDE - IoT Energético       ");
  console.log("🌿 ═══════════════════════════════════════════════════\n");

  // Validar configuración
  const { valido, errores } = validarConfiguracion();
  if (!valido) {
    console.error("❌ Errores de configuración:");
    errores.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }

  // Mostrar configuración
  mostrarConfiguracion();

  try {
    // Autenticar
    console.log("🔐 Autenticando simulador...");
    await loginSimulador();

    // Obtener puntos
    console.log("📡 Obteniendo puntos de monitoreo...");
    const puntos = await obtenerPuntos();
    
    if (puntos.length === 0) {
      console.error("❌ No se encontraron puntos de monitoreo");
      process.exit(1);
    }

    mostrarPuntos(puntos);

    // Ejecutar según modo
    console.log("\n🚀 Iniciando simulación...");
    
    if (CONFIG.MODO === "historico") {
      await ejecutarHistorico(puntos);
    } else {
      await ejecutarTiempoReal(puntos);
    }

  } catch (err) {
    console.error("\n❌ Error fatal:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Manejo de señales para cierre limpio
process.on('SIGINT', () => {
  console.log("\n\n👋 Simulador detenido por el usuario");
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log("\n\n👋 Simulador terminado");
  process.exit(0);
});

// Iniciar
iniciar();

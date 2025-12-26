// ============================================
// CONFIGURACIÓN DEL SIMULADOR NUBE VERDE
// ============================================

export const CONFIG = {
  // ------------------------------------------
  // CONFIGURACIÓN DE TIEMPO
  // ------------------------------------------
  
  // Frecuencia de envío de lecturas (en milisegundos)
  // Ejemplo: 10000 = 10 segundos, 60000 = 1 minuto
  INTERVALO_MS: 10000,

  // Fecha de inicio para simulación histórica
  // Formato: "YYYY-MM-DD HH:mm:ss" o null para tiempo real
  // Ejemplo: "2025-01-01 00:00:00" para simular desde el 1 de enero
  FECHA_INICIO: "2025-01-01 00:00:00",

  // Fecha de fin para simulación histórica
  // null = tiempo real (si FECHA_INICIO es null) o hasta hoy (si hay FECHA_INICIO)
  // Ejemplo: "2025-01-31 23:59:59" para simular hasta el 31 de enero
  FECHA_FIN: null,

  // Incremento de tiempo por cada tick cuando se simula histórico
  // Ejemplo: 3600000 = 1 hora por tick, 900000 = 15 minutos por tick
  INCREMENTO_TIEMPO_MS: 3600000, // 1 hora

  // ------------------------------------------
  // CONFIGURACIÓN DE SIMULACIÓN DE PICOS
  // ------------------------------------------
  
  // Activar/desactivar simulación de picos de consumo
  SIMULAR_PICOS: false,

  // Horarios considerados como "pico" (formato 24h)
  HORARIOS_PICO: {
    MANANA: { inicio: 8, fin: 12 },
    TARDE: { inicio: 14, fin: 18 }
  },

  // Multiplicador de consumo en horarios pico
  // Ejemplo: 1.5 = 50% más consumo en horarios pico
  FACTOR_PICO: 1.5,

  // Factor de reducción para fines de semana (0 = domingo, 6 = sábado)
  // Ejemplo: 0.3 = solo 30% del consumo normal
  FACTOR_FIN_SEMANA: 0.3,

  // ------------------------------------------
  // CONFIGURACIÓN DE CONSUMO
  // ------------------------------------------
  
  // Variación aleatoria sobre el consumo base (porcentaje)
  // Ejemplo: 0.2 = ±20% de variación
  VARIACION_CONSUMO: 0.2,

  // Probabilidad de estado "error" (0 a 1)
  // Ejemplo: 0.02 = 2% de probabilidad
  PROBABILIDAD_ERROR: 0.02,

  // ------------------------------------------
  // CONFIGURACIÓN DE MODO
  // ------------------------------------------
  
  // Modo de simulación:
  // "tiempo_real" - Genera lecturas con fecha actual
  // "historico" - Genera lecturas desde FECHA_INICIO hasta FECHA_FIN
  get MODO() {
    return this.FECHA_INICIO ? "historico" : "tiempo_real";
  },

  // Cantidad de lecturas a enviar por lote en modo histórico
  // Útil para no saturar Firestore
  BATCH_SIZE: 10,

  // Delay entre lotes en modo histórico (ms)
  DELAY_ENTRE_LOTES: 1000
};

// ============================================
// FUNCIONES AUXILIARES DE CONFIGURACIÓN
// ============================================

/**
 * Parsea una fecha string a objeto Date
 * @param {string|null} fechaStr - Fecha en formato "YYYY-MM-DD HH:mm:ss"
 * @returns {Date|null}
 */
export function parsearFecha(fechaStr) {
  if (!fechaStr) return null;
  return new Date(fechaStr.replace(" ", "T"));
}

/**
 * Valida la configuración actual
 * @returns {{ valido: boolean, errores: string[] }}
 */
export function validarConfiguracion() {
  const errores = [];

  if (CONFIG.INTERVALO_MS < 1000) {
    errores.push("INTERVALO_MS debe ser al menos 1000ms (1 segundo)");
  }

  if (CONFIG.FECHA_INICIO && CONFIG.FECHA_FIN) {
    const inicio = parsearFecha(CONFIG.FECHA_INICIO);
    const fin = parsearFecha(CONFIG.FECHA_FIN);
    if (inicio >= fin) {
      errores.push("FECHA_INICIO debe ser anterior a FECHA_FIN");
    }
  }

  if (CONFIG.FACTOR_PICO < 1) {
    errores.push("FACTOR_PICO debe ser al menos 1");
  }

  if (CONFIG.FACTOR_FIN_SEMANA < 0 || CONFIG.FACTOR_FIN_SEMANA > 1) {
    errores.push("FACTOR_FIN_SEMANA debe estar entre 0 y 1");
  }

  return {
    valido: errores.length === 0,
    errores
  };
}

/**
 * Muestra la configuración actual en consola
 */
export function mostrarConfiguracion() {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║     CONFIGURACIÓN SIMULADOR NUBE VERDE     ║");
  console.log("╠════════════════════════════════════════════╣");
  console.log(`║ Modo:              ${CONFIG.MODO.padEnd(22)} ║`);
  console.log(`║ Intervalo:         ${(CONFIG.INTERVALO_MS / 1000 + "s").padEnd(22)} ║`);
  console.log(`║ Simular picos:     ${(CONFIG.SIMULAR_PICOS ? "Sí" : "No").padEnd(22)} ║`);
  
  if (CONFIG.MODO === "historico") {
    console.log(`║ Fecha inicio:      ${CONFIG.FECHA_INICIO?.substring(0, 16).padEnd(22) || "N/A".padEnd(22)} ║`);
    console.log(`║ Fecha fin:         ${CONFIG.FECHA_FIN?.substring(0, 16).padEnd(22) || "Hoy".padEnd(22)} ║`);
    console.log(`║ Incremento:        ${(CONFIG.INCREMENTO_TIEMPO_MS / 60000 + " min").padEnd(22)} ║`);
  }
  
  console.log("╚════════════════════════════════════════════╝\n");
}

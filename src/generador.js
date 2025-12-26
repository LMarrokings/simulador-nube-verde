import { CONFIG } from "../config/config.js";

/**
 * Genera una lectura de consumo energético para un punto de monitoreo
 * 
 * Reglas implementadas:
 * 1. Si punto.activo = false → consumo = 0, estado = "inactivo"
 * 2. Usa consumo_base_kwh y potencia_base_w del punto para cálculos
 * 3. Aplica factores de pico según horario (si SIMULAR_PICOS = true)
 * 4. Aplica factor de fin de semana
 * 5. Los picos solo se simulan desde FECHA_INICIO configurada
 * 
 * @param {Object} punto - Objeto completo del punto de monitoreo
 * @param {Date} fechaSimulada - Fecha para la lectura (puede ser histórica)
 * @returns {Object} Lectura generada
 */
export function generarLectura(punto, fechaSimulada = new Date()) {
  // ==========================================
  // REGLA 1: Punto inactivo → consumo cero
  // ==========================================
  if (!punto.activo) {
    return {
      id_punto: punto.id,
      estado: "inactivo",
      consumo_kwh: 0,
      fecha: fechaSimulada
    };
  }

  // ==========================================
  // REGLA 2: Probabilidad de error
  // ==========================================
  if (Math.random() < CONFIG.PROBABILIDAD_ERROR) {
    return {
      id_punto: punto.id,
      estado: "error",
      consumo_kwh: 0,
      fecha: fechaSimulada
    };
  }

  // ==========================================
  // CALCULAR CONSUMO BASE
  // ==========================================
  let consumo = punto.consumo_base_kwh;

  // ==========================================
  // REGLA 3: Aplicar factor de picos
  // Solo si SIMULAR_PICOS está activo
  // ==========================================
  if (CONFIG.SIMULAR_PICOS && deberiaaplicarPico(fechaSimulada)) {
    const hora = fechaSimulada.getHours();
    
    if (esHorarioPico(hora)) {
      consumo *= CONFIG.FACTOR_PICO;
    }
  }

  // ==========================================
  // REGLA 4: Aplicar factor fin de semana
  // ==========================================
  const diaSemana = fechaSimulada.getDay();
  const esFinDeSemana = (diaSemana === 0 || diaSemana === 6);
  
  if (esFinDeSemana) {
    consumo *= CONFIG.FACTOR_FIN_SEMANA;
  }

  // ==========================================
  // APLICAR VARIACIÓN ALEATORIA
  // ==========================================
  const variacion = 1 + (Math.random() * 2 - 1) * CONFIG.VARIACION_CONSUMO;
  consumo *= variacion;

  // ==========================================
  // CONSTRUIR Y RETORNAR LECTURA
  // ==========================================
  return {
    id_punto: punto.id,
    estado: "activo",
    consumo_kwh: +consumo.toFixed(2),
    fecha: fechaSimulada
  };
}

/**
 * Determina si debe aplicarse el factor de pico según la fecha
 * Los picos solo se simulan desde FECHA_INICIO en adelante
 * 
 * @param {Date} fecha - Fecha a evaluar
 * @returns {boolean}
 */
function deberiaaplicarPico(fecha) {
  // Si no hay FECHA_INICIO configurada, siempre aplicar picos
  if (!CONFIG.FECHA_INICIO) {
    return true;
  }

  // Parsear FECHA_INICIO
  const fechaInicio = new Date(CONFIG.FECHA_INICIO.replace(" ", "T"));
  
  // Solo aplicar picos si la fecha simulada es >= FECHA_INICIO
  return fecha >= fechaInicio;
}

/**
 * Verifica si una hora está dentro de horario pico
 * 
 * @param {number} hora - Hora en formato 24h (0-23)
 * @returns {boolean}
 */
function esHorarioPico(hora) {
  const { MANANA, TARDE } = CONFIG.HORARIOS_PICO;
  
  const enPicoManana = hora >= MANANA.inicio && hora < MANANA.fin;
  const enPicoTarde = hora >= TARDE.inicio && hora < TARDE.fin;
  
  return enPicoManana || enPicoTarde;
}

/**
 * Genera información de debug sobre la lectura
 * Útil para verificar que las reglas se aplican correctamente
 * 
 * @param {Object} punto - Punto de monitoreo
 * @param {Date} fecha - Fecha de la lectura
 * @returns {Object} Información de debug
 */
export function debugLectura(punto, fecha = new Date()) {
  const hora = fecha.getHours();
  const diaSemana = fecha.getDay();
  
  return {
    punto_id: punto.id,
    punto_activo: punto.activo,
    consumo_base: punto.consumo_base_kwh,
    fecha: fecha.toISOString(),
    hora,
    dia_semana: ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"][diaSemana],
    es_fin_semana: diaSemana === 0 || diaSemana === 6,
    es_horario_pico: esHorarioPico(hora),
    simular_picos_activo: CONFIG.SIMULAR_PICOS,
    deberia_aplicar_pico: deberiaaplicarPico(fecha)
  };
}

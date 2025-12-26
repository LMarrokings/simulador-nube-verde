import { collection, addDoc, Timestamp } from "firebase/firestore";
import { db } from "./firebase.js";

/**
 * Envía una lectura a Firestore
 * Convierte la fecha JavaScript a Timestamp de Firestore
 * 
 * @param {Object} lectura - Lectura generada por generador.js
 * @returns {Promise<string>} ID del documento creado
 */
export async function enviarLectura(lectura) {
  // Convertir Date de JavaScript a Timestamp de Firestore
  const lecturaFirestore = {
    id_punto: lectura.id_punto,
    estado: lectura.estado,
    consumo_kwh: lectura.consumo_kwh,
    fecha: Timestamp.fromDate(lectura.fecha)
  };

  const docRef = await addDoc(collection(db, "lecturas"), lecturaFirestore);

  return docRef.id;
}

/**
 * Envía múltiples lecturas en lote
 * Útil para modo histórico
 * 
 * @param {Array<Object>} lecturas - Array de lecturas
 * @returns {Promise<number>} Cantidad de lecturas enviadas
 */
export async function enviarLecturasBatch(lecturas) {
  let enviadas = 0;
  
  for (const lectura of lecturas) {
    await enviarLectura(lectura);
    enviadas++;
  }
  
  return enviadas;
}

/**
 * Formatea una lectura para mostrar en consola
 * @param {Object} lectura 
 * @returns {string}
 */
export function formatearLecturaLog(lectura) {
  const fecha = lectura.fecha instanceof Date 
    ? lectura.fecha.toLocaleString('es-SV', { timeZone: 'America/El_Salvador' })
    : lectura.fecha;
    
  const estadoEmoji = {
    activo: "🟢",
    inactivo: "⚫",
    error: "🔴"
  };
  
  return `${estadoEmoji[lectura.estado] || "⚪"} ${lectura.id_punto.padEnd(10)} | ${lectura.consumo_kwh.toString().padStart(6)} kWh | ${fecha}`;
}

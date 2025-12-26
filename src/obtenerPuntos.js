import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase.js";

/**
 * Obtiene todos los puntos de monitoreo con su información completa
 * @returns {Promise<Array>} Array de objetos con datos completos de cada punto
 * 
 * Estructura esperada de cada punto:
 * {
 *   id: "N1",
 *   nombre: "Auditorio Principal",
 *   descripcion: "Capacidad 500 personas",
 *   ubicacion: "Edificio Cultural",
 *   activo: true,
 *   consumo_base_kwh: 15.5,
 *   potencia_base_w: 1100
 * }
 */
export async function obtenerPuntos() {
  const snap = await getDocs(collection(db, "puntos_monitoreo"));
  
  return snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      // ID del documento en Firestore (necesario para actualizar)
      docId: docSnap.id,
      
      // Identificación
      id: data.id,
      nombre: data.nombre || `Punto ${data.id}`,
      descripcion: data.descripcion || "",
      ubicacion: data.ubicacion || "",
      
      // Estado
      activo: data.activo ?? true, // Por defecto activo si no existe el campo
      
      // Valores base para cálculos
      consumo_base_kwh: data.consumo_base_kwh || 5.0,
      potencia_base_w: data.potencia_base_w || 500
    };
  });
}

/**
 * Obtiene solo los IDs de los puntos (compatibilidad con versión anterior)
 * @returns {Promise<Array<string>>} Array de IDs
 */
export async function obtenerIdsPuntos() {
  const puntos = await obtenerPuntos();
  return puntos.map(p => p.id);
}

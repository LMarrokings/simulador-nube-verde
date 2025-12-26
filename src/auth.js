import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase.js";

export async function loginSimulador() {
  const email = "simulador@nubeverde.local";
  const password = "grupo6";

  const cred = await signInWithEmailAndPassword(auth, email, password);
  console.log("✅ Simulador autenticado:", cred.user.email);
}

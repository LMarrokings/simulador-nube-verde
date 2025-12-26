import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAE_pViacv5LR9DpalknyS5nuu-TJcTsxw",
  authDomain: "nube-verde-monitor.firebaseapp.com",
  projectId: "nube-verde-monitor",
  storageBucket: "nube-verde-monitor.firebasestorage.app",
  messagingSenderId: "694437356246",
  appId: "1:694437356246:web:0b6792fd2a913727739f77"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
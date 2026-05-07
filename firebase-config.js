import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDiVOmt0LPHlDOTVrY6wzYopoy5fzmFDE4",
  authDomain: "safe-web-portal.firebaseapp.com",
  projectId: "safe-web-portal",
  storageBucket: "safe-web-portal.firebasestorage.app",
  messagingSenderId: "833629640759",
  appId: "1:833629640759:web:38909dd1a4413f78d007b2",
  measurementId: "G-FTLFPF2PV0"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

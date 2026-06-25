import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Public Firebase Configuration (provisioned by AI Studio)
const firebaseConfig = {
  apiKey: "AIzaSyDiDbNRnSraWQN2xBgXLhVLxY74X1itetQ",
  authDomain: "unified-verve-1mvz5.firebaseapp.com",
  projectId: "unified-verve-1mvz5",
  storageBucket: "unified-verve-1mvz5.firebasestorage.app",
  messagingSenderId: "283912536690",
  appId: "1:283912536690:web:d06ff167774985aedc78eb"
};

const databaseId = "ai-studio-a225123c-ec1d-47b3-a094-8fd973ff0172";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, databaseId);
export const auth = getAuth(app);

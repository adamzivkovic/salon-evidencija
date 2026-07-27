import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyD0wTEyvrg6PZuk8bxgR3k2VkOLx2eDLQo",
  authDomain: "salon-2cats-evidencija.firebaseapp.com",
  projectId: "salon-2cats-evidencija",
  storageBucket: "salon-2cats-evidencija.firebasestorage.app",
  messagingSenderId: "19075813339",
  appId: "1:19075813339:web:74e0ddefcf4146f62021fe",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

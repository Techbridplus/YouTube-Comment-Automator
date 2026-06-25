import React, { useState, useEffect } from "react";
import { 
  Youtube, 
  Settings, 
  Play, 
  Square, 
  Plus, 
  Trash2, 
  Sparkles, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  Users, 
  MessageSquare, 
  Sliders, 
  ExternalLink,
  ChevronRight,
  LogOut,
  HelpCircle
} from "lucide-react";
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  addDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy 
} from "firebase/firestore";
import { db, auth } from "./firebase";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail,
  User as FirebaseUser,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";

// Helper to extract YouTube video ID from various video/livestream URL patterns
function extractYoutubeId(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  // If it's already an 11-character video ID, just return it
  if (trimmed.length === 11 && !trimmed.includes("/") && !trimmed.includes(".")) {
    return trimmed;
  }
  try {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|live\/|shorts\/)([^#\&\?]*).*/;
    const match = trimmed.match(regExp);
    if (match && match[2] && match[2].length === 11) {
      return match[2];
    }
  } catch (e) {
    console.error("Failed to parse YouTube URL regex:", e);
  }
  return trimmed;
}

interface YTAccount {
  id: string;
  channelId: string;
  displayName: string;
  avatar: string;
  createdAt: number;
}

interface CommentItem {
  id: string;
  text: string;
  createdAt: number;
}

interface ActivityLog {
  id: string;
  timestamp: number;
  accountId: string;
  accountName: string;
  commentText: string;
  status: "success" | "failed";
  message: string;
}

interface CommentSettings {
  targetType: "live_chat" | "video";
  targetId: string;
  interval: number;
  rotation: "sequential" | "random";
  active: boolean;
}

export default function App() {
  // Auth state
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "forgot">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Configuration status
  const [googleConfigured, setGoogleConfigured] = useState<boolean>(false);
  const [googleClientId, setGoogleClientId] = useState<string>("");

  // DB entities state
  const [accounts, setAccounts] = useState<YTAccount[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [settings, setSettings] = useState<CommentSettings>({
    targetType: "live_chat",
    targetId: "",
    interval: 15,
    rotation: "sequential",
    active: false
  });

  // UI Local state
  const [newCommentText, setNewCommentText] = useState<string>("");
  const [geminiPrompt, setGeminiPrompt] = useState<string>("");
  const [spinning, setSpinning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  // Load backend configurations
  const checkConfig = async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setGoogleConfigured(data.googleConfigured);
        setGoogleClientId(data.googleClientId);
      }
    } catch (err) {
      console.error("Failed to fetch backend configuration:", err);
    }
  };

  useEffect(() => {
    checkConfig();

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        
        // Firestore Sync listeners scoped to users/{uid}
        const unsubscribeAccounts = onSnapshot(collection(db, "users", user.uid, "accounts"), (snapshot) => {
          const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as YTAccount));
          setAccounts(list);
        });

        const unsubscribeComments = onSnapshot(collection(db, "users", user.uid, "comments"), (snapshot) => {
          const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as CommentItem));
          list.sort((a, b) => b.createdAt - a.createdAt);
          setComments(list);
        });

        const unsubscribeLogs = onSnapshot(
          query(collection(db, "users", user.uid, "logs"), orderBy("timestamp", "desc")),
          (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as ActivityLog));
            setLogs(list);
          }
        );

        // Fetch settings or create if not exists
        const settingsRef = doc(db, "users", user.uid);
        const unsubscribeSettings = onSnapshot(settingsRef, async (snap) => {
          if (snap.exists()) {
            setSettings(snap.data() as CommentSettings);
          } else {
            const defaultSettings: CommentSettings = {
              targetType: "live_chat",
              targetId: "",
              interval: 15,
              rotation: "sequential",
              active: false
            };
            await setDoc(settingsRef, defaultSettings);
            setSettings(defaultSettings);
          }
          setLoading(false);
        }, (err) => {
          console.error("Error subscribing to settings:", err);
          setLoading(false);
        });

        // Store unsubs so we can clear them on user change/logout
        return () => {
          unsubscribeAccounts();
          unsubscribeComments();
          unsubscribeLogs();
          unsubscribeSettings();
        };
      } else {
        setCurrentUser(null);
        setAccounts([]);
        setComments([]);
        setLogs([]);
        setSettings({
          targetType: "live_chat",
          targetId: "",
          interval: 15,
          rotation: "sequential",
          active: false
        });
        setLoading(false);
      }
      setAuthLoading(false);
    });

    // Listener for successfully connected accounts via OAuth callback
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        setSuccessMsg("YouTube account connected successfully!");
        setTimeout(() => setSuccessMsg(""), 4000);
      }
    };
    window.addEventListener("message", handleAuthMessage);

    return () => {
      unsubscribeAuth();
      window.removeEventListener("message", handleAuthMessage);
    };
  }, []);

  // Submit signin/signup
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    setAuthSubmitting(true);

    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else if (authMode === "signup") {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        setAuthSuccess("Account created successfully!");
      } else if (authMode === "forgot") {
        await sendPasswordResetEmail(auth, authEmail);
        setAuthSuccess("Password reset email sent!");
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      let message = err.message || "Authentication failed.";
      if (err.code === "auth/invalid-credential") {
        message = "Invalid email or password.";
      } else if (err.code === "auth/email-already-in-use") {
        message = "This email is already registered.";
      } else if (err.code === "auth/weak-password") {
        message = "Password should be at least 6 characters.";
      } else if (err.code === "auth/invalid-email") {
        message = "Please enter a valid email address.";
      }
      setAuthError(message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  // Sign out
  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Failed to sign out:", err);
    }
  };

  // Google Authentication Sign In / Sign Up
  const handleGoogleAuth = async () => {
    setAuthError("");
    setAuthSuccess("");
    setAuthSubmitting(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setAuthSuccess("Signed in with Google successfully!");
    } catch (err: any) {
      console.error("Google Auth error:", err);
      let message = err.message || "Google authentication failed.";
      if (err.code === "auth/popup-blocked") {
        message = "Popup blocked by your browser. Please allow popups for this site.";
      } else if (err.code === "auth/cancelled-popup-request") {
        message = "The sign-in popup was closed before completion.";
      }
      setAuthError(message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  // Update Settings
  const saveSettings = async (updates: Partial<CommentSettings>) => {
    if (!currentUser) return;
    const nextSettings = { ...settings, ...updates };
    setSettings(nextSettings);
    try {
      await setDoc(doc(db, "users", currentUser.uid), nextSettings);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  // Add a single custom comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!newCommentText.trim()) return;
    try {
      await addDoc(collection(db, "users", currentUser.uid, "comments"), {
        text: newCommentText.trim(),
        createdAt: Date.now()
      });
      setNewCommentText("");
      setSuccessMsg("Comment added successfully!");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setErrorMsg("Failed to add comment to Firestore.");
      setTimeout(() => setErrorMsg(""), 3000);
    }
  };

  // Delete a comment
  const handleDeleteComment = async (id: string) => {
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, "users", currentUser.uid, "comments", id));
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  // Remove a connected account
  const handleRemoveAccount = async (id: string) => {
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, "users", currentUser.uid, "accounts", id));
      setSuccessMsg("Account disconnected.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error("Failed to remove account:", err);
    }
  };

  // Trigger Google OAuth Login Popup
  const handleConnectAccount = async () => {
    if (!currentUser) return;
    try {
      const origin = window.location.origin;
      const response = await fetch(`/api/auth/url?origin=${encodeURIComponent(origin)}&state=${currentUser.uid}`);
      if (!response.ok) {
        throw new Error("Failed to get authorization URL from backend.");
      }
      const { url } = await response.json();

      const authWindow = window.open(
        url,
        "youtube_oauth_popup",
        "width=600,height=750"
      );

      if (!authWindow) {
        alert("Popup blocked! Please allow popups for this site to log in with your YouTube account.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to trigger Google Authentication.");
      setTimeout(() => setErrorMsg(""), 4000);
    }
  };

  // Clear Activity Logs
  const handleClearLogs = async () => {
    if (!currentUser) return;
    try {
      const logsSnap = await getDocs(collection(db, "users", currentUser.uid, "logs"));
      for (const logDoc of logsSnap.docs) {
        await deleteDoc(doc(db, "users", currentUser.uid, "logs", logDoc.id));
      }
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  // Generate comment variations using Gemini
  const handleSpinComments = async () => {
    if (!currentUser) return;
    if (!geminiPrompt.trim()) return;
    setSpinning(true);
    setErrorMsg("");
    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch("/api/generate-variations", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({ prompt: geminiPrompt.trim() })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate variations.");
      }

      const { variations } = await response.json();
      if (Array.isArray(variations) && variations.length > 0) {
        for (const variation of variations) {
          await addDoc(collection(db, "users", currentUser.uid, "comments"), {
            text: variation,
            createdAt: Date.now()
          });
        }
        setGeminiPrompt("");
        setSuccessMsg(`Generated ${variations.length} unique variations!`);
        setTimeout(() => setSuccessMsg(""), 4000);
      } else {
        throw new Error("Invalid output received from AI.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Error communicating with Gemini model.");
      setTimeout(() => setErrorMsg(""), 5000);
    } finally {
      setSpinning(false);
    }
  };

  // Start Automation Engine
  const handleStartAutomation = async () => {
    if (!settings.targetId.trim()) {
      setErrorMsg("Please enter a Target YouTube Video ID or Live Stream ID first.");
      setTimeout(() => setErrorMsg(""), 4000);
      return;
    }
    if (accounts.length === 0) {
      setErrorMsg("Please connect at least one YouTube account first.");
      setTimeout(() => setErrorMsg(""), 4000);
      return;
    }
    if (comments.length === 0) {
      setErrorMsg("Please add at least one comment to the comment pool.");
      setTimeout(() => setErrorMsg(""), 4000);
      return;
    }

    await saveSettings({ active: true });
    setSuccessMsg("Live stream automation is now ACTIVE.");
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  // Stop Automation Engine
  const handleStopAutomation = async () => {
    await saveSettings({ active: false });
    setSuccessMsg("Automation engine successfully STOPPED.");
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100">
        <RefreshCw className="w-12 h-12 text-rose-500 animate-spin mb-4" />
        <p className="text-slate-400 font-medium font-sans">Initializing StreamCast Automation Studio...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 font-sans relative overflow-hidden">
        {/* Decorative background blurs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="w-full max-w-md z-10">
          {/* Header Branding */}
          <div className="flex flex-col items-center mb-8">
            <div className="bg-rose-500/10 p-3.5 rounded-2xl border border-rose-500/20 mb-3 shadow-inner">
              <Youtube className="w-10 h-10 text-rose-500" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-rose-500 via-pink-500 to-amber-500 bg-clip-text text-transparent">
              StreamCast
            </h1>
            <p className="text-sm text-slate-400 mt-1 font-medium">YouTube Live Stream Automation Studio</p>
          </div>

          {/* Card Body */}
          <div className="bg-slate-900/60 border border-slate-800 backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-2xl">
            {authMode !== "forgot" && (
              <div className="flex border-b border-slate-800 mb-6 p-0.5 bg-slate-950/60 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthError("");
                    setAuthSuccess("");
                  }}
                  className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${
                    authMode === "login"
                      ? "bg-slate-800 text-slate-100 shadow-sm border border-slate-700/50"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signup");
                    setAuthError("");
                    setAuthSuccess("");
                  }}
                  className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${
                    authMode === "signup"
                      ? "bg-slate-800 text-slate-100 shadow-sm border border-slate-700/50"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Create Account
                </button>
              </div>
            )}

            <h2 className="text-xl font-bold text-slate-100 mb-2">
              {authMode === "login" && "Welcome Back"}
              {authMode === "signup" && "Get Started"}
              {authMode === "forgot" && "Reset Password"}
            </h2>
            <p className="text-xs text-slate-400 mb-6">
              {authMode === "login" && "Access your secure automation dashboard and stream logs."}
              {authMode === "signup" && "Create a secure account to persist comment templates and streams."}
              {authMode === "forgot" && "Enter your email address and we'll send you a password reset link."}
            </p>

            {authError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2.5 text-xs text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            {authSuccess && (
              <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-start gap-2.5 text-xs text-emerald-400">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="name@domain.com"
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors"
                />
              </div>

              {authMode !== "forgot" && (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Password
                    </label>
                    {authMode === "login" && (
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode("forgot");
                          setAuthError("");
                          setAuthSuccess("");
                        }}
                        className="text-xs text-rose-400 hover:text-rose-300 transition-colors font-medium"
                      >
                        Forgot?
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-colors"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-semibold py-2.5 px-4 rounded-lg shadow-lg hover:shadow-rose-500/10 transition-all focus:ring-2 focus:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
              >
                {authSubmitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {authMode === "login" && "Sign In"}
                    {authMode === "signup" && "Create Account"}
                    {authMode === "forgot" && "Send Reset Link"}
                  </>
                )}
              </button>
            </form>

            {authMode !== "forgot" && (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-800" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-slate-900/60 px-2 text-slate-500">Or continue with</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={authSubmitting}
                  className="w-full flex items-center justify-center gap-2.5 bg-slate-950 hover:bg-slate-900 text-slate-200 border border-slate-800 rounded-lg py-2.5 px-4 font-semibold text-sm transition-all focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
                >
                  <svg className="w-4.5 h-4.5 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#EA4335"
                      d="M12.24 10.285V14.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.866-3.577-7.866-8s3.536-8 7.866-8c2.46 0 4.105 1.025 5.047 1.926l3.227-3.107C18.215 1.54 15.42 1 12.24 1 6.01 1 1 5.923 1 12s5.01 11 11.24 11c6.5 0 10.82-4.51 10.82-10.82 0-.73-.08-1.285-.177-1.895H12.24z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>
              </>
            )}

            {authMode === "forgot" && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthError("");
                    setAuthSuccess("");
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors font-medium flex items-center justify-center gap-1 mx-auto"
                >
                  Back to Sign In
                </button>
              </div>
            )}
          </div>

          <p className="text-center text-xs text-slate-600 mt-6">
            Protected by multi-tier isolated database structures & Google Identity verification.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100">
        <RefreshCw className="w-12 h-12 text-rose-500 animate-spin mb-4" />
        <p className="text-slate-400 font-medium font-sans">Syncing StreamCast workspace...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
              <Youtube className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-rose-500 to-amber-500 bg-clip-text text-transparent">
                StreamCast
              </h1>
              <p className="text-xs text-slate-400 font-medium">YouTube Live Stream Automation Studio</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Engine Status Badge */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              settings.active 
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 animate-pulse" 
                : "bg-slate-800 border-slate-700 text-slate-400"
            }`}>
              <span className={`w-2 h-2 rounded-full ${settings.active ? "bg-emerald-400" : "bg-slate-500"}`}></span>
              {settings.active ? "ENGINE ACTIVE" : "ENGINE INACTIVE"}
            </div>

            <button 
              onClick={checkConfig} 
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700"
              title="Refresh connection status"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* User Profile / Email & Sign Out */}
            <div className="hidden md:flex flex-col items-end text-right border-l border-slate-800 pl-4">
              <span className="text-xs text-slate-300 font-medium">{currentUser?.email}</span>
              <span className="text-[10px] text-slate-500 font-mono">ID: {currentUser?.uid.slice(0, 8)}</span>
            </div>

            <button
              onClick={handleSignOut}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Configuration & Accounts (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">

          {/* Setup Alerts & Warnings */}
          {!googleConfigured && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex gap-3.5 text-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold mb-1">Google Credentials Required</p>
                <p className="text-slate-300 leading-relaxed mb-2.5">
                  Google Client ID and Client Secret must be configured as secrets in the AI Studio settings menu before initiating YouTube OAuth connections.
                </p>
                <div className="bg-slate-900/60 p-3 rounded-lg text-xs font-mono text-slate-400 space-y-1">
                  <div>• Key 1: <strong className="text-slate-300">GOOGLE_CLIENT_ID</strong></div>
                  <div>• Key 2: <strong className="text-slate-300">GOOGLE_CLIENT_SECRET</strong></div>
                  <div>• Redirect URI: <code className="text-rose-400 select-all">{window.location.origin}/api/auth/callback</code></div>
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex gap-3 text-rose-300">
              <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
              <p className="text-sm font-medium">{errorMsg}</p>
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex gap-3 text-emerald-300">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="text-sm font-medium">{successMsg}</p>
            </div>
          )}

          {/* Control Center */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
            <div className="border-b border-slate-800 bg-slate-950/40 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-4 h-4 text-rose-500" />
                <h2 className="font-semibold text-slate-200">Automation Controls</h2>
              </div>
            </div>
            <div className="p-5 space-y-5">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Target Type selector */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Target Style
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => saveSettings({ targetType: "live_chat" })}
                      className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                        settings.targetType === "live_chat"
                          ? "bg-rose-500 text-white shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Live Chat
                    </button>
                    <button
                      type="button"
                      onClick={() => saveSettings({ targetType: "video" })}
                      className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                        settings.targetType === "video"
                          ? "bg-rose-500 text-white shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Video Comment
                    </button>
                  </div>
                </div>

                {/* Delay Interval */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Comment Delay (seconds)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="1800"
                    value={settings.interval}
                    onChange={(e) => saveSettings({ interval: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-200 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>

              </div>

              {/* Target YouTube ID */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Target YouTube Video or Live ID
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. kH9N_6z1M-A"
                    value={settings.targetId}
                    onChange={(e) => saveSettings({ targetId: extractYoutubeId(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-10 py-2 text-sm font-medium text-slate-200 focus:outline-none focus:border-rose-500 transition-colors placeholder:text-slate-600"
                  />
                  {settings.targetId && (
                    <a
                      href={`https://youtube.com/watch?v=${settings.targetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 transition-colors"
                      title="Open in YouTube"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Provide the 11-character video ID from the YouTube URL (e.g., watch?v=<strong>kH9N_6z1M-A</strong>).
                </p>
              </div>

              {/* Rotation Style */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Account Selection Mode
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => saveSettings({ rotation: "sequential" })}
                    className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                      settings.rotation === "sequential"
                        ? "bg-slate-800 text-rose-400 shadow-sm border border-slate-700/50"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Sequential Rotation
                  </button>
                  <button
                    type="button"
                    onClick={() => saveSettings({ rotation: "random" })}
                    className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                      settings.rotation === "random"
                        ? "bg-slate-800 text-rose-400 shadow-sm border border-slate-700/50"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Random Draw
                  </button>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="pt-2 flex gap-3">
                {settings.active ? (
                  <button
                    type="button"
                    onClick={handleStopAutomation}
                    className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-rose-900/20 transition-all hover:-translate-y-0.5"
                  >
                    <Square className="w-4 h-4 fill-white" />
                    Stop Engine
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartAutomation}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-emerald-950/20 transition-all hover:-translate-y-0.5"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    Start Engine
                  </button>
                )}
              </div>

            </div>
          </section>

          {/* Accounts Panel */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
            <div className="border-b border-slate-800 bg-slate-950/40 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-rose-500" />
                <h2 className="font-semibold text-slate-200">YouTube Account Pool ({accounts.length})</h2>
              </div>
              
              <button
                type="button"
                onClick={handleConnectAccount}
                disabled={!googleConfigured}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  googleConfigured 
                    ? "bg-rose-600 hover:bg-rose-500 text-white cursor-pointer" 
                    : "bg-slate-800 text-slate-500 cursor-not-allowed"
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Channel
              </button>
            </div>

            <div className="p-5">
              {accounts.length === 0 ? (
                <div className="text-center py-8 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
                  <Youtube className="w-10 h-10 text-slate-700 mx-auto mb-2.5" />
                  <p className="text-sm font-semibold text-slate-400 mb-1">No channels connected</p>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    Authenticate multiple accounts to rotate them and bypass spam protection limits.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {accounts.map((acc) => (
                    <div 
                      key={acc.id} 
                      className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {acc.avatar ? (
                          <img 
                            src={acc.avatar} 
                            alt={acc.displayName} 
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-slate-800" 
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center shrink-0 font-bold text-slate-400 text-sm">
                            {acc.displayName.slice(0, 1)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-200 truncate">{acc.displayName}</p>
                          <p className="text-[10px] text-slate-500 font-mono truncate">{acc.channelId}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveAccount(acc.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                        title="Disconnect channel"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

        </div>

        {/* Right Column: Comment Pool & AI Spinner (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">

          {/* AI Comment Spinner (Gemini Integration) */}
          <section className="bg-gradient-to-br from-slate-900 to-indigo-950/20 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
            <div className="border-b border-slate-800 bg-slate-950/40 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h2 className="font-semibold text-slate-200">AI Comment Spinner</h2>
              </div>
            </div>

            <div className="p-5">
              <p className="text-xs text-slate-400 leading-relaxed mb-4">
                To prevent comment blocking on fast livestreams, use Gemini AI to generate 5 human-like variations of a base statement instantly.
              </p>

              <div className="space-y-3">
                <textarea
                  placeholder="e.g. This livestream is fantastic! Keep up the amazing work!"
                  rows={2}
                  value={geminiPrompt}
                  onChange={(e) => setGeminiPrompt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm font-medium text-slate-200 focus:outline-none focus:border-amber-500 transition-colors placeholder:text-slate-600 resize-none"
                />

                <button
                  type="button"
                  onClick={handleSpinComments}
                  disabled={spinning || !geminiPrompt.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-slate-950 font-bold py-2 px-4 rounded-xl transition-all shadow-md"
                >
                  {spinning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Spinning variations...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Spin 5 Variations with Gemini
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* Comment Pool */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg flex-1 flex flex-col min-h-[300px]">
            <div className="border-b border-slate-800 bg-slate-950/40 px-5 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <MessageSquare className="w-4 h-4 text-rose-500" />
                <h2 className="font-semibold text-slate-200">Comment Phrase Pool ({comments.length})</h2>
              </div>
            </div>

            {/* Manual entry */}
            <form onSubmit={handleAddComment} className="p-4 border-b border-slate-800 bg-slate-950/20 shrink-0 flex gap-2">
              <input
                type="text"
                placeholder="Add manual comment phrase..."
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 focus:outline-none focus:border-rose-500 transition-colors placeholder:text-slate-600"
              />
              <button
                type="submit"
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center justify-center shrink-0 text-slate-300"
              >
                Add
              </button>
            </form>

            <div className="p-4 flex-1 overflow-y-auto max-h-[350px] space-y-2">
              {comments.length === 0 ? (
                <div className="text-center py-10">
                  <MessageSquare className="w-8 h-8 text-slate-800 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">No phrases inside comment pool yet.</p>
                </div>
              ) : (
                comments.map((item) => (
                  <div 
                    key={item.id} 
                    className="bg-slate-950/70 border border-slate-800/60 rounded-lg p-2.5 flex items-start justify-between gap-3 hover:border-slate-800 transition-colors"
                  >
                    <p className="text-xs font-medium text-slate-300 leading-relaxed break-words flex-1">
                      {item.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(item.id)}
                      className="p-1 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors shrink-0 mt-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

        </div>

      </main>

      {/* Activity Logs Panel - Spanning full width at the bottom */}
      <footer className="border-t border-slate-800 bg-slate-900/40 p-4 md:p-6 shrink-0 mt-auto">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-rose-500 animate-spin" style={{ animationDuration: '6s' }} />
              <h3 className="font-semibold text-slate-200 text-sm">Real-Time Execution Log</h3>
            </div>
            
            {logs.length > 0 && (
              <button
                type="button"
                onClick={handleClearLogs}
                className="text-xs font-semibold text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Logs
              </button>
            )}
          </div>

          <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 h-44 overflow-y-auto font-mono text-[11px] space-y-2">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">Logs are empty. Run automation to start capturing results.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex flex-wrap items-start gap-x-2 border-b border-slate-900/60 pb-1.5 last:border-0 last:pb-0">
                  <span className="text-slate-500 shrink-0">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>
                  
                  <span className={`font-semibold shrink-0 ${log.status === "success" ? "text-emerald-400" : "text-rose-400"}`}>
                    {log.status === "success" ? "● SUCCESS" : "▲ FAILED"}
                  </span>
                  
                  <span className="text-rose-400/90 font-bold shrink-0">
                    [{log.accountName}]
                  </span>
                  
                  <span className="text-slate-300 break-all flex-1">
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

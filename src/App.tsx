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
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import { db, auth } from "./firebase";

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
  username?: string;
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
  // Configuration status
  const [googleConfigured, setGoogleConfigured] = useState<boolean>(false);
  const [googleClientId, setGoogleClientId] = useState<string>("");

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

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
  const [activeTab, setActiveTab] = useState<"automation" | "manual">("automation");
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
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    checkConfig();

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

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    
    // Firestore Sync listeners
    const unsubscribeAccounts = onSnapshot(collection(db, "accounts"), (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as YTAccount));
      setAccounts(list);
    });

    const unsubscribeComments = onSnapshot(collection(db, "comments"), (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as CommentItem));
      // Sort comments by creation date descending
      list.sort((a, b) => b.createdAt - a.createdAt);
      setComments(list);
    });

    const unsubscribeLogs = onSnapshot(
      query(collection(db, "logs"), orderBy("timestamp", "desc")),
      (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as ActivityLog));
        setLogs(list);
      }
    );

    const syncSettings = async () => {
      try {
        const settingsRef = doc(db, "settings", "global");
        const snap = await getDoc(settingsRef);
        if (snap.exists()) {
          setSettings(snap.data() as CommentSettings);
        } else {
          // Initialize default settings in DB
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
      } catch (err) {
        console.error("Error fetching settings:", err);
      } finally {
        setLoading(false);
      }
    };

    syncSettings();

    return () => {
      unsubscribeAccounts();
      unsubscribeComments();
      unsubscribeLogs();
    };
  }, [user]);

  // Update Settings
  const saveSettings = async (updates: Partial<CommentSettings>) => {
    const nextSettings = { ...settings, ...updates };
    setSettings(nextSettings);
    try {
      await setDoc(doc(db, "settings", "global"), nextSettings);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  // Add a single custom comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;
    try {
      await addDoc(collection(db, "comments"), {
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
    try {
      await deleteDoc(doc(db, "comments", id));
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  // Remove a connected account
  const handleRemoveAccount = async (id: string) => {
    try {
      await deleteDoc(doc(db, "accounts", id));
      setSuccessMsg("Account disconnected.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error("Failed to remove account:", err);
    }
  };

  // Trigger Google OAuth Login Popup
  const handleConnectAccount = async () => {
    try {
      const origin = window.location.origin;
      const response = await fetch(`/api/auth/url?origin=${encodeURIComponent(origin)}`);
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
    try {
      const logsSnap = await getDocs(collection(db, "logs"));
      for (const logDoc of logsSnap.docs) {
        await deleteDoc(doc(db, "logs", logDoc.id));
      }
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  // Generate comment variations using Gemini
  const handleSpinComments = async () => {
    if (!geminiPrompt.trim()) return;
    setSpinning(true);
    setErrorMsg("");
    try {
      const response = await fetch("/api/generate-variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: geminiPrompt.trim() })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate variations.");
      }

      const { variations } = await response.json();
      if (Array.isArray(variations) && variations.length > 0) {
        // Save all generated variations to DB
        for (const variation of variations) {
          await addDoc(collection(db, "comments"), {
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

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Login failed:", err);
      setErrorMsg(err.message || "Failed to log in.");
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100">
        <RefreshCw className="w-12 h-12 text-rose-500 animate-spin mb-4" />
        <p className="text-slate-400 font-medium">Initializing StreamCast Automation Studio...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 w-16 h-16 mx-auto mb-6 flex items-center justify-center">
            <Youtube className="w-8 h-8 text-rose-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-2">StreamCast Studio</h1>
          <p className="text-slate-400 mb-8 text-sm">Sign in to access your YouTube automation dashboard and manage your account pool.</p>
          
          {errorMsg && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 mb-6 text-rose-300 text-sm">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-900 font-bold py-3 px-4 rounded-xl transition-colors shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>
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
            <div className="hidden md:flex bg-slate-900 border border-slate-800 rounded-lg p-1">
              <button
                onClick={() => setActiveTab("automation")}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeTab === "automation" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Engine
              </button>
              <button
                onClick={() => setActiveTab("manual")}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeTab === "manual" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Manual Reply
              </button>
            </div>

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

            <button 
              onClick={() => auth.signOut()} 
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Mobile Tabs */}
        <div className="md:hidden flex border-t border-slate-800 bg-slate-950">
           <button
            onClick={() => setActiveTab("automation")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "automation" ? "text-rose-400 border-b-2 border-rose-500" : "text-slate-400"
            }`}
          >
            Engine
          </button>
          <button
            onClick={() => setActiveTab("manual")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "manual" ? "text-rose-400 border-b-2 border-rose-500" : "text-slate-400"
            }`}
          >
            Manual Reply
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        {activeTab === "automation" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
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
      </div>
    ) : (
      <ManualReplyHub accounts={accounts} settings={settings} />
    )}
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

function ManualReplyHub({ accounts, settings }: { accounts: YTAccount[], settings: CommentSettings }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<YTAccount | null>(null);
  const [commentText, setCommentText] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{type: "error" | "success", msg: string} | null>(null);

  const filteredAccounts = accounts.filter(acc => 
    acc.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (acc.username && acc.username.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handlePost = async () => {
    if (!selectedAccount) return;
    if (!commentText.trim()) {
      setStatusMsg({ type: "error", msg: "Comment text cannot be empty." });
      return;
    }
    if (!settings.targetId) {
      setStatusMsg({ type: "error", msg: "Target video ID is missing in Engine settings." });
      return;
    }

    setIsPosting(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/post-comment-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccount.id,
          targetId: settings.targetId,
          targetType: settings.targetType,
          commentText
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post comment");
      
      setStatusMsg({ type: "success", msg: "Comment posted successfully!" });
      setCommentText("");
    } catch (err: any) {
      setStatusMsg({ type: "error", msg: err.message });
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold text-white mb-2">Account Checker & Manual Reply</h2>
        <p className="text-sm text-slate-400 mb-6">
          Paste an account name below to verify if it exists in your pool, then reply directly as that account.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Search Account Name
            </label>
            <input
              type="text"
              placeholder="e.g. John Doe"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-rose-500 transition-colors placeholder:text-slate-600"
            />
          </div>

          {searchTerm && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg max-h-60 overflow-y-auto p-2 space-y-1">
              {filteredAccounts.length > 0 ? (
                filteredAccounts.map(acc => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setSelectedAccount(acc);
                      setSearchTerm("");
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-slate-900 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <img src={acc.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=" + acc.displayName} alt="" className="w-8 h-8 rounded-full bg-slate-800" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-200">{acc.displayName}</span>
                        {acc.username && <span className="text-xs text-slate-500">{acc.username}</span>}
                      </div>
                    </div>
                    <span className="text-xs text-rose-400 font-medium bg-rose-500/10 px-2 py-1 rounded">Select</span>
                  </button>
                ))
              ) : (
                <div className="p-4 text-center text-sm text-slate-500">
                  No accounts found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedAccount && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-800">
            <img src={selectedAccount.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=" + selectedAccount.displayName} alt="" className="w-12 h-12 rounded-full bg-slate-800 border-2 border-slate-700" />
            <div>
              <h3 className="text-lg font-bold text-white">{selectedAccount.displayName}</h3>
              <p className="text-xs text-slate-400">Selected for manual reply</p>
            </div>
            <button 
              onClick={() => setSelectedAccount(null)}
              className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Change Account
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Your Reply
              </label>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write your response here..."
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-4 text-sm text-slate-200 focus:outline-none focus:border-rose-500 transition-colors placeholder:text-slate-600 resize-none"
              />
            </div>

            {statusMsg && (
              <div className={`p-3 rounded-lg text-sm border ${
                statusMsg.type === "success" 
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                  : "bg-rose-500/10 border-rose-500/30 text-rose-400"
              }`}>
                {statusMsg.msg}
              </div>
            )}

            <button
              onClick={handlePost}
              disabled={isPosting || !commentText.trim()}
              className="w-full bg-rose-500 hover:bg-rose-600 disabled:opacity-50 disabled:hover:bg-rose-500 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isPosting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              {isPosting ? "Posting..." : "Post Reply"}
            </button>
            <p className="text-center text-[11px] text-slate-500 mt-2">
              Will post to the target defined in Engine Settings ({settings.targetType}).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

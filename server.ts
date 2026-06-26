import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  limit 
} from "firebase/firestore";

// Initialize Express
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Firebase setup
const firebaseConfig = {
  apiKey: "AIzaSyDiDbNRnSraWQN2xBgXLhVLxY74X1itetQ",
  authDomain: "unified-verve-1mvz5.firebaseapp.com",
  projectId: "unified-verve-1mvz5",
  storageBucket: "unified-verve-1mvz5.firebasestorage.app",
  messagingSenderId: "283912536690",
  appId: "1:283912536690:web:d06ff167774985aedc78eb"
};
const databaseId = "ai-studio-a225123c-ec1d-47b3-a094-8fd973ff0172";

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, databaseId);

// Global commenter state
let lastPostedTime = 0;
let accountPointer = 0;
let commentPointer = 0;

// Helper to write activity log
async function logActivity(account: any, status: "success" | "failed", message: string) {
  try {
    const logsCol = collection(db, "logs");
    await addDoc(logsCol, {
      timestamp: Date.now(),
      accountId: account ? account.channelId : "system",
      accountName: account ? account.displayName : "System",
      commentText: message,
      status: status,
      message: message
    });
  } catch (err) {
    console.error("Failed to write log to Firestore:", err);
  }
}

// Helper to refresh Google OAuth token
async function refreshGoogleToken(refreshToken: string) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!googleClientId || !googleClientSecret) {
    throw new Error("Google Client ID or Client Secret not configured in secrets.");
  }

  const tokenUrl = "https://oauth2.googleapis.com/token";
  const params = new URLSearchParams({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token refresh failed: ${errText}`);
  }

  const data: any = await res.json();
  return {
    accessToken: data.access_token,
    tokenExpiry: Date.now() + (data.expires_in || 3600) * 1000
  };
}

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

// Helper to post comments to normal video or live stream
async function executeCommentPost(account: any, comment: string, settings: any) {
  const targetId = extractYoutubeId(settings.targetId);
  const targetType = settings.targetType; // "live_chat" or "video"
  let accessToken = account.accessToken;

  // 1. Refresh token if expired (or close to expiring: less than 5 mins)
  if (Date.now() > (account.tokenExpiry - 300000)) {
    console.log(`Token for channel ${account.displayName} is expiring. Refreshing...`);
    try {
      const refreshed = await refreshGoogleToken(account.refreshToken);
      accessToken = refreshed.accessToken;
      
      const accountRef = doc(db, "accounts", account.id);
      await updateDoc(accountRef, {
        accessToken: refreshed.accessToken,
        tokenExpiry: refreshed.tokenExpiry
      });
      console.log(`Successfully refreshed token for channel ${account.displayName}.`);
    } catch (refreshErr: any) {
      const errMsg = `Failed to refresh OAuth token: ${refreshErr.message || refreshErr}`;
      await logActivity(account, "failed", errMsg);
      return;
    }
  }

  try {
    if (targetType === "live_chat") {
      // YouTube Live Chat integration
      // A. Retrieve activeLiveChatId for live stream Video ID
      const videoListUrl = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(targetId)}&part=liveStreamingDetails`;
      const videoRes = await fetch(videoListUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (!videoRes.ok) {
        const errText = await videoRes.text();
        throw new Error(`Failed to fetch live stream details: ${errText}`);
      }
      
      const videoData: any = await videoRes.json();
      if (!videoData.items || videoData.items.length === 0) {
        throw new Error(`Live stream or video with ID '${targetId}' not found.`);
      }
      
      const liveDetails = videoData.items[0].liveStreamingDetails;
      if (!liveDetails || !liveDetails.activeLiveChatId) {
        throw new Error(`Video '${targetId}' has no active live chat. Make sure the livestream is currently active/live.`);
      }
      
      const activeLiveChatId = liveDetails.activeLiveChatId;

      // B. Post message to active live chat
      const chatUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet`;
      const chatRes = await fetch(chatUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          snippet: {
            liveChatId: activeLiveChatId,
            type: "textMessageEvent",
            textMessageDetails: {
              messageText: comment
            }
          }
        })
      });

      if (!chatRes.ok) {
        const errText = await chatRes.text();
        throw new Error(`Live Chat Post failed: ${errText}`);
      }

      await logActivity(account, "success", `[Live Chat] Posted: "${comment}"`);

    } else {
      // Normal YouTube Video Comment
      const commentUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet`;
      const commentRes = await fetch(commentUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          snippet: {
            videoId: targetId,
            topLevelComment: {
              snippet: {
                textOriginal: comment
              }
            }
          }
        })
      });

      if (!commentRes.ok) {
        const errText = await commentRes.text();
        throw new Error(`Video Comment Post failed: ${errText}`);
      }

      await logActivity(account, "success", `[Video Comment] Posted: "${comment}"`);
    }

  } catch (err: any) {
    const errMsg = err.message || err;
    await logActivity(account, "failed", `Error posting: ${errMsg}`);
  }
}

// Background commenter loop checker
async function checkAndPostComment() {
  try {
    const settingsRef = doc(db, "settings", "global");
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) return;
    
    const settings = settingsSnap.data();
    if (!settings.active) return;

    const intervalMs = (settings.interval || 10) * 1000;
    const now = Date.now();
    if (now - lastPostedTime < intervalMs) return;

    // Fetch accounts
    const accountsCol = collection(db, "accounts");
    const accountsSnap = await getDocs(accountsCol);
    const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (accounts.length === 0) {
      await logActivity(null, "failed", "No connected YouTube accounts. Automation paused.");
      await updateDoc(settingsRef, { active: false });
      return;
    }

    // Fetch comments
    const commentsCol = collection(db, "comments");
    const commentsSnap = await getDocs(commentsCol);
    const comments = commentsSnap.docs.map(doc => doc.data().text);

    if (comments.length === 0) {
      await logActivity(null, "failed", "No comments in pool. Please add comments.");
      await updateDoc(settingsRef, { active: false });
      return;
    }

    // Post in parallel for all accounts
    lastPostedTime = now;

    const postPromises = accounts.map(async (account, index) => {
      let commentIndex = 0;
      if (settings.rotation === "random") {
        commentIndex = Math.floor(Math.random() * comments.length);
      } else {
        commentIndex = (commentPointer + index) % comments.length;
      }
      
      const selectedComment = comments[commentIndex];
      await executeCommentPost(account, selectedComment, settings);
    });

    if (settings.rotation !== "random") {
      commentPointer += accounts.length;
    }

    await Promise.all(postPromises);

  } catch (error: any) {
    console.error("Background commenter worker execution error:", error);
  }
}

// Run loop checker every 3 seconds
setInterval(checkAndPostComment, 3000);


// API ENDPOINTS

// 1. Check if Google credentials are set up
app.get("/api/config", (req, res) => {
  res.json({
    googleConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    googleClientId: process.env.GOOGLE_CLIENT_ID || ""
  });
});

// 2. Build Google OAuth URL
app.get("/api/auth/url", (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const origin = req.query.origin || process.env.APP_URL;

  if (!googleClientId) {
    return res.status(500).json({ error: "Google Client ID is not configured." });
  }

  const redirectUri = `${origin}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/userinfo.profile",
    access_type: "offline",
    prompt: "consent"
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

// 3. OAuth callback handler
app.get(["/api/auth/callback", "/api/auth/callback/"], async (req, res) => {
  const { code } = req.query;
  
  let origin = process.env.APP_URL;
  if (!origin) {
    const host = req.get("host") || "localhost:3000";
    const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
    origin = `${protocol}://${host}`;
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!code) {
    return res.status(400).send("Authorization code is missing.");
  }

  try {
    // Exchange Auth Code for Access/Refresh tokens
    const tokenUrl = "https://oauth2.googleapis.com/token";
    const redirectUri = `${origin}/api/auth/callback`;

    const tokenParams = new URLSearchParams({
      code: code as string,
      client_id: googleClientId!,
      client_secret: googleClientSecret!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString()
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }

    const tokenData: any = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token; // Received only if prompt=consent is set
    const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;

    // Fetch Google User Profile (Channel name and avatar)
    const profileUrl = "https://www.googleapis.com/oauth2/v3/userinfo";
    const profileRes = await fetch(profileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    let displayName = "YouTube User";
    let avatar = "";
    let channelId = "unknown";
    let username = "";

    if (profileRes.ok) {
      const profileData: any = await profileRes.json();
      displayName = profileData.name || displayName;
      avatar = profileData.picture || avatar;
      channelId = profileData.sub || channelId;
    }

    // Try to get YouTube channel details specifically
    try {
      const youtubeChannelUrl = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
      const ytRes = await fetch(youtubeChannelUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (ytRes.ok) {
        const ytData: any = await ytRes.json();
        if (ytData.items && ytData.items.length > 0) {
          const ytChannel = ytData.items[0];
          channelId = ytChannel.id;
          displayName = ytChannel.snippet.title;
          if (ytChannel.snippet.customUrl) {
            username = ytChannel.snippet.customUrl;
          }
          if (ytChannel.snippet.thumbnails && ytChannel.snippet.thumbnails.default) {
            avatar = ytChannel.snippet.thumbnails.default.url;
          }
        }
      }
    } catch (ytErr) {
      console.warn("Could not retrieve precise YouTube channel snippet:", ytErr);
    }

    // Must have a refresh token to persist automation.
    // If not returned by Google, reuse the existing one if we already have it in DB,
    // otherwise warn the user to disconnect and reconnect with consent.
    let finalRefreshToken = refreshToken;
    
    const accountDocRef = doc(db, "accounts", channelId);
    const existingSnap = await getDoc(accountDocRef);
    if (!finalRefreshToken && existingSnap.exists()) {
      finalRefreshToken = existingSnap.data().refreshToken;
    }

    if (!finalRefreshToken) {
      return res.send(`
        <html>
          <body>
            <script>
              alert("Warning: No refresh token returned. Please disconnect the account and click connect again to allow offline access.");
              window.close();
            </script>
          </body>
        </html>
      `);
    }

    // Save/Update Account in Firestore
    await setDoc(accountDocRef, {
      channelId,
      displayName,
      username,
      avatar,
      accessToken,
      refreshToken: finalRefreshToken,
      tokenExpiry: expiresAt,
      createdAt: Date.now()
    });

    await logActivity({ channelId, displayName }, "success", "YouTube channel authenticated successfully.");

    // Send success postMessage and close the window
    res.send(`
      <html>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #f8fafc; text-align: center;">
          <div>
            <h1 style="color: #22c55e; margin-bottom: 12px;">Connection Successful!</h1>
            <p style="font-size: 16px; color: #94a3b8;">Your channel <strong>${displayName}</strong> has been linked.</p>
            <p style="font-size: 14px; color: #64748b;">This popup will close automatically...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: "OAUTH_AUTH_SUCCESS" }, "*");
                setTimeout(() => window.close(), 1000);
              } else {
                window.location.href = "/";
              }
            </script>
          </div>
        </body>
      </html>
    `);

  } catch (err: any) {
    console.error("OAuth callback error:", err);
    res.status(500).send(`Authentication failed: ${err.message || err}`);
  }
});

app.post("/api/post-comment-manual", async (req, res) => {
  try {
    const { accountId, targetId, targetType, commentText } = req.body;
    if (!accountId || !targetId || !targetType || !commentText) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const accountRef = doc(db, "accounts", accountId);
    const accountSnap = await getDoc(accountRef);
    if (!accountSnap.exists()) {
      return res.status(404).json({ error: "Account not found." });
    }

    const accountData = { id: accountSnap.id, ...accountSnap.data() };
    const settings = { targetId, targetType };

    await executeCommentPost(accountData, commentText, settings);
    res.json({ success: true, message: "Comment posted successfully." });
  } catch (error: any) {
    console.error("Manual post error:", error);
    res.status(500).json({ error: error.message || "Failed to post comment." });
  }
});

// 4. Gemini Comment Spinner API
app.post("/api/generate-variations", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Base comment prompt is required." });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).json({ error: "Gemini API Key is not configured." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const model = "gemini-2.5-flash";
    const systemInstruction = `
      You are an expert copywriter. The user will provide a base comment.
      Your task is to generate exactly 5 creative, human-like, and highly engaging variations of this comment.
      These variations will be used to comment on YouTube live streams or videos.
      To ensure YouTube does not flag them as duplicates or spam:
      - Use slightly different vocabulary, structures, and expressions.
      - Keep them natural, enthusiastic, and contextual (e.g. general livestream encouragement, positive feedback, friendly greetings).
      - Do NOT use robotic or overly spammy language.
      - Return ONLY a JSON array of strings containing the 5 variations, with no markdown codeblocks, explanatory text, or other wrappers.
      Example Output: ["Wow this is great!", "Loving the stream so far!", "Keep it up, awesome content!", "Such a cool stream!", "This live stream is super helpful!"]
    `;

    const aiRes = await ai.models.generateContent({
      model: model,
      contents: [systemInstruction, `Generate variations for: "${prompt}"`]
    });

    const text = aiRes.text?.trim() || "[]";
    let cleanedText = text;
    if (text.startsWith("```")) {
      cleanedText = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }
    const variations = JSON.parse(cleanedText);
    res.json({ variations });
  } catch (err: any) {
    console.error("Gemini variations generation error:", err);
    res.status(500).json({ error: err.message || "Failed to generate variations" });
  }
});


// MOUNT VITE MIDDLEWARE OR SERVE PRODUCTION BUILD
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

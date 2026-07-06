# ⚡ BitPipe

BitPipe is a lightning-fast, premium web application designed to download YouTube media and analyze playlist durations. Built with a modern React frontend and a powerful Node.js backend, BitPipe completely bypasses typical bottleneck restrictions using dynamic extractors, aggressive in-memory caching, and official API fallbacks.

## 🌟 Key Features

*   **Single Video Downloader**: Extract and download specific video or audio formats instantly.
*   **Batch Queue & ZIP**: Add multiple videos to a sidebar queue and download them all at once, packed neatly into a ZIP file with real-time SSE (Server-Sent Events) progress streaming.
*   **Playlist Calculator**: Paste a YouTube playlist URL to instantly calculate total viewing time. Adjust start/end ranges and apply custom playback speeds to see exactly how long a binge session will take.
*   **Built-in Trimming**: Select custom start and end times to trim a video before downloading.
*   **Blazing Fast Metadata**: Utilizes `@distube/ytdl-core` and the official **YouTube Data API v3** to fetch video and playlist metadata in milliseconds, circumventing the slow startup times of traditional Python scrapers.
*   **Premium Workspace UI**: A highly polished, dark-mode focused Data Dashboard UI built with Tailwind CSS.

---

## 🏗️ Architecture & Flow

BitPipe is split into two primary environments: a Vite/React Frontend and an Express/Node.js Backend.

### The Frontend (React + Vite + Tailwind CSS)
The frontend acts as a unified command center. 
*   **State Management**: React handles complex state switching between the Downloader view and the Playlist Calculator dashboard without reloading the page.
*   **The Queue Sidebar**: A sleek, right-aligned sliding drawer manages the user's batch queue locally until they are ready to initiate a mass download.
*   **SSE Connections**: When a batch download is triggered, the frontend establishes an `EventSource` connection to the backend to stream live progress updates (e.g., "Downloading 2 / 5") directly into the UI.

### The Backend (Node.js + Express)
The backend is a highly optimized orchestration layer.
1.  **Metadata Fetching (`/api/info` & `/getPlaylistLength`)**: 
    *   To ensure instant UI feedback, the backend uses `node-cache` to store responses in memory.
    *   Single videos use `@distube/ytdl-core` for 1-second fetches.
    *   Playlists use the official YouTube Data API v3 to fetch 50 videos at a time in milliseconds.
2.  **Downloading (`/downloadVideo`)**: 
    *   Uses `yt-dlp-exec` (a Node wrapper for `yt-dlp`) to spawn robust Python subprocesses. This bypasses YouTube's strict bot protections and throttling.
    *   Cookies (`cookies.txt`) are dynamically injected if a video requires authentication.
3.  **Batch Processing (`/downloadBatch`)**:
    *   Downloads queued items sequentially.
    *   Uses `archiver` to stream the downloaded files into a single `.zip` file on the server.
    *   Pushes real-time progress via Server-Sent Events (SSE) back to the client.

---

## 🚀 Local Setup & Installation

### Prerequisites
*   Node.js (v18+ recommended)
*   Python 3 (required for `yt-dlp`)
*   FFmpeg (required for video/audio muxing and trimming)

### 1. Clone the Repository
```bash
git clone https://github.com/akash-zeroDev/BitPipe.git
cd BitPipe
```

### 2. Backend Setup
```bash
cd backend
npm install
```
*   Create a `.env` file in the `backend` directory.
*   Add your YouTube API Key to enable instant playlist fetching:
    ```env
    YOUTUBE_API=your_google_cloud_api_key_here
    PORT=10000
    ```
*   Start the server:
    ```bash
    npm run start
    ```

### 3. Frontend Setup
```bash
# Open a new terminal tab
cd frontend
npm install
```
*   Start the Vite development server:
    ```bash
    npm run dev
    ```

---

## 🛠️ Tech Stack

*   **Frontend**: React, Vite, Tailwind CSS, Lucide React (Icons)
*   **Backend**: Node.js, Express, CORS
*   **Extractors**: `yt-dlp-exec`, `@distube/ytdl-core`, YouTube Data API v3
*   **Utilities**: `node-cache` (Memory), `archiver` (ZIPs), `ffmpeg-static`

## 📝 License
This project is for educational purposes. Please ensure compliance with YouTube's Terms of Service when deploying or utilizing scraping tools.

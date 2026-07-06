import { useState, useEffect } from "react";
import { Download, Settings, Video, Headphones, ChevronDown, ChevronUp, Check, X, Scissors, Archive } from "lucide-react";
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';

function App() {
  const [url, setUrl] = useState("");
  const [detail, setDetail] = useState(false);
  const [data, setData] = useState(null);
  
  // Advanced Settings State
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [includeVideo, setIncludeVideo] = useState(true);
  const [includeAudio, setIncludeAudio] = useState(true);
  
  const [videoFormats, setVideoFormats] = useState([]);
  const [audioFormats, setAudioFormats] = useState([]);
  
  // Trimming State
  const [isTrimming, setIsTrimming] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [startInput, setStartInput] = useState("0:00");
  const [endInput, setEndInput] = useState("0:00");

  // Batch Queue State
  const [queue, setQueue] = useState([]);
  const [showQueue, setShowQueue] = useState(false);

  // Playlist Calculator State
  const [mode, setMode] = useState('downloader'); // 'downloader' | 'playlist'
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
  const [playlistData, setPlaylistData] = useState(null);
  const [playlistError, setPlaylistError] = useState(false);
  const [playlistStart, setPlaylistStart] = useState("");
  const [playlistEnd, setPlaylistEnd] = useState("");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [jobId, setJobId] = useState(null);
  const [batchStatus, setBatchStatus] = useState(null); // 'processing', 'completed', 'error'
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchTitle, setBatchTitle] = useState("");

  const parseTime = (timeStr) => {
    if (!timeStr) return 0;
    const parts = timeStr.toString().split(':').map(Number);
    if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
    return parseInt(parts[0]) || 0;
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  
  const [selectedVideo, setSelectedVideo] = useState("");
  const [selectedAudio, setSelectedAudio] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const apiUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

  const fetchData = async (url) => {
    setDetail(false);
    setError(false);
    try {
      const res = await fetch(`${apiUrl}/getVideoInfo`, {
        method: "POST",
        body: JSON.stringify({ videoURL: url }),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        const formats = json.data.formats || [];
        
        // Filter and Deduplicate Videos (Resolutions)
        const rawVideos = formats.filter(f => 
          f.vcodec !== 'none' && 
          (f.acodec === 'none' || !f.acodec) && 
          f.format_note && 
          f.format_note !== "storyboard"
        );
        const uniqueVids = Array.from(new Map(rawVideos.map(item => [item.format_note, item])).values()).reverse();
        
        // Filter Audios
        const rawAudios = formats.filter(f => 
          f.acodec !== 'none' && 
          (f.vcodec === 'none' || !f.vcodec || f.resolution === 'audio only')
        );
        const uniqueAuds = Array.from(new Map(rawAudios.map(item => [item.format_id, item])).values()).reverse();

        if (uniqueVids.length === 0) {
          uniqueVids.push({ format_id: "bestvideo", format_note: "Default (Auto)", ext: "mp4" });
        }
        if (uniqueAuds.length === 0) {
          uniqueAuds.push({ format_id: "bestaudio", ext: "m4a" });
        }

        setVideoFormats(uniqueVids);
        setAudioFormats(uniqueAuds);
        
        if (uniqueVids.length > 0) setSelectedVideo(uniqueVids[0].format_id);
        if (uniqueAuds.length > 0) setSelectedAudio(uniqueAuds[0].format_id);

        const dur = json.data?.duration || 0;
        setStartTime(0);
        setStartInput(formatTime(0));
        setEndTime(dur);
        setEndInput(formatTime(dur));

        setData(json);
        setDetail(true);
      } else {
        setError(true);
      }
    } catch (err) {
      setError(true);
      console.error(err);
    }
    setIsLoading(false);
  };

  const handleSubmit = (e) => {
    if (e.key === "Enter" || e.type === "click") {
      if (url.trim() !== "") {
        setIsLoading(true);
        fetchData(url);
      } else {
        setDetail(false);
        setError(true);
      }
    }
  };

  useEffect(() => {
    if (!jobId) return;

    const eventSource = new EventSource(`${apiUrl}/progress?jobId=${jobId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setBatchStatus(data.status);
      setBatchProgress(data.progress);
      setBatchTotal(data.total);
      setBatchTitle(data.currentTitle);

      if (data.status === 'completed') {
        eventSource.close();
        setJobId(null);
        // Trigger download
        const a = document.createElement('a');
        a.href = `${apiUrl}/downloadJob/${jobId}`;
        a.download = 'BitPipe_Batch.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else if (data.status === 'error') {
        eventSource.close();
        setJobId(null);
        alert("Batch download failed on the server.");
      }
    };

    eventSource.onerror = (error) => {
      console.error("EventSource failed:", error);
      eventSource.close();
      setJobId(null);
      setBatchStatus('error');
    };

    return () => eventSource.close();
  }, [jobId]);

  const downloadBatch = async () => {
    if (queue.length === 0) return;
    setBatchStatus('processing');
    setBatchProgress(0);
    setBatchTotal(queue.length);
    setBatchTitle('Initializing...');
    
    try {
      const res = await fetch(`${apiUrl}/downloadBatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ items: queue })
      });
      const data = await res.json();
      if (data.success) {
        setJobId(data.jobId);
      } else {
        alert("Failed to start batch download: " + data.error);
        setBatchStatus('error');
      }
    } catch (err) {
      console.error(err);
      alert("Network error starting batch.");
      setBatchStatus('error');
    }
  };

  const handleDownload = (isDefault = true, addToQueue = false) => {
    let finalFormat = "bestvideo+bestaudio/best";
    let ext = "mkv";
    
    if (!isDefault) {
      if (includeVideo && includeAudio) {
        finalFormat = `${selectedVideo}+${selectedAudio}`;
        ext = "mkv"; 
      } else if (includeVideo) {
        finalFormat = selectedVideo;
        ext = videoFormats.find(f => f.format_id === selectedVideo)?.ext || "mp4";
      } else if (includeAudio) {
        finalFormat = selectedAudio;
        ext = audioFormats.find(f => f.format_id === selectedAudio)?.ext || "m4a";
      } else {
        alert("Please enable at least Audio or Video!");
        return;
      }

      if (isTrimming) {
        ext = "mkv";
      }
    }

    if (addToQueue) {
      const item = {
        videoURL: url,
        format_id: finalFormat,
        ext: ext,
        title: data?.data?.title || "Video",
        thumbnail: data?.data?.thumbnail
      };
      if (isTrimming && startTime !== undefined && endTime !== undefined) {
        item.startTime = startTime;
        item.endTime = endTime;
      }
      setQueue([...queue, item]);
      return;
    }

    try {
      const queryParams = {
        videoURL: url,
        format_id: finalFormat,
        ext: ext,
        title: data?.data?.title || "Video"
      };

      if (isTrimming && startTime !== undefined && endTime !== undefined) {
        queryParams.startTime = startTime;
        queryParams.endTime = endTime;
      }

      const query = new URLSearchParams(queryParams).toString();
      
      window.location.href = `${apiUrl}/downloadVideo?${query}`;
    } catch (err) {
      console.error("Error during download:", err);
    }
  };

  const handlePlaylistSubmit = async () => {
    if (!playlistUrl) return;
    setIsPlaylistLoading(true);
    setPlaylistError(false);
    setPlaylistData(null);
    setPlaylistStart("");
    setPlaylistEnd("");
    setPlaybackSpeed(1);
    try {
      const response = await fetch(`${apiUrl}/getPlaylistLength?playlistURL=${encodeURIComponent(playlistUrl)}`);
      const res = await response.json();
      if (res.success) {
        setPlaylistData(res.data);
      } else {
        setPlaylistError(true);
      }
    } catch (err) {
      console.error(err);
      setPlaylistError(true);
    } finally {
      setIsPlaylistLoading(false);
    }
  };

  const getCalculatedDuration = () => {
    if (!playlistData) return 0;
    const totalVids = playlistData.durations.length;
    const sIdx = Math.max(1, parseInt(playlistStart) || 1) - 1;
    let eIdx = parseInt(playlistEnd);
    if (isNaN(eIdx) || eIdx > totalVids) eIdx = totalVids;
    
    if (sIdx >= eIdx) return 0;
    
    const slice = playlistData.durations.slice(sIdx, eIdx);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / parseFloat(playbackSpeed || 1);
  };
  
  const getCalculatedVideoCount = () => {
    if (!playlistData) return 0;
    const totalVids = playlistData.durations.length;
    const sIdx = Math.max(1, parseInt(playlistStart) || 1) - 1;
    let eIdx = parseInt(playlistEnd);
    if (isNaN(eIdx) || eIdx > totalVids) eIdx = totalVids;
    
    if (sIdx >= eIdx) return 0;
    return eIdx - sIdx;
  };

  const formatDuration = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  };

  return (
    <>
      {/* Floating Queue Button */}
      <button 
        onClick={() => setShowQueue(true)}
        className="fixed top-6 right-6 bg-white/30 backdrop-blur-md border border-white/50 text-white p-3 rounded-full shadow-lg hover:bg-white/40 transition flex items-center gap-2 z-40"
      >
        <Archive size={24} />
        {queue.length > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {queue.length}
          </span>
        )}
      </button>

      {/* Queue Drawer Modal */}
      {showQueue && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-end z-50">
          <div className="w-full md:w-96 bg-slate-50 h-full shadow-2xl border-l border-gray-200 flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-white">
              <h2 className="text-xl font-extrabold text-gray-950 flex items-center gap-2"><Archive size={24}/> Batch Queue</h2>
              <button onClick={() => setShowQueue(false)} className="text-gray-500 hover:text-gray-950 hover:bg-gray-100 p-2 rounded-full transition"><X size={24} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
              {queue.length === 0 ? (
                <div className="text-center text-gray-500 mt-10 font-medium">Your queue is empty.</div>
              ) : (
                queue.map((item, idx) => (
                  <div key={idx} className="flex gap-3 bg-white p-3 rounded-xl shadow-sm border border-gray-100 items-center">
                    <img src={item.thumbnail} className="w-20 h-14 object-cover rounded-md" alt="thumb" />
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-bold text-gray-800 truncate">{item.title}</p>
                      <p className="text-xs text-gray-500 mt-1 uppercase font-semibold">{item.ext} • {item.startTime ? 'Trimmed' : 'Full'}</p>
                    </div>
                    <button 
                      onClick={() => setQueue(queue.filter((_, i) => i !== idx))}
                      className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {queue.length > 0 && (
              <div className="p-4 border-t border-[#30363d] bg-[#161b22]">
              {batchStatus === 'processing' ? (
                <div className="w-full">
                  <div className="flex justify-between text-sm text-[#8b949e] mb-2">
                    <span>{batchTitle}</span>
                    <span>{batchProgress} / {batchTotal}</span>
                  </div>
                  <div className="w-full bg-[#0d1117] rounded-full h-2.5">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                      style={{ width: `${batchTotal > 0 ? (batchProgress / batchTotal) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={downloadBatch}
                  disabled={queue.length === 0}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <Download size={20} />
                  Download All as ZIP
                </button>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      <div className="min-h-screen w-full bg-[#F9FAFB] flex items-center justify-center p-4">
        <div className="bg-[#0A0A0B] w-full md:w-3/4 h-auto md:h-3/4 rounded-[2rem] border border-gray-800 shadow-2xl p-6 md:p-10 flex flex-col">
          
          {/* Mode Toggle */}
          <div className="flex bg-gray-900 border border-gray-800 rounded-full p-1.5 w-full max-w-md mx-auto mb-8 shadow-inner">
            <button 
              onClick={() => setMode('downloader')}
              className={`flex-1 py-2.5 rounded-full font-bold text-sm transition-all duration-200 ${mode === 'downloader' ? 'bg-white text-black shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            >
              Downloader
            </button>
            <button 
              onClick={() => setMode('playlist')}
              className={`flex-1 py-2.5 rounded-full font-bold text-sm transition-all duration-200 ${mode === 'playlist' ? 'bg-white text-black shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            >
              Playlist Calculator
            </button>
          </div>

          {mode === 'downloader' ? (
            <>
              <h1 className="text-white text-4xl md:text-6xl text-center md:text-left font-extrabold tracking-tight mt-2">
                Your Videos, <span className="text-gray-400">Offline Anytime.</span>
              </h1>

          <div className="flex flex-col md:flex-row items-center md:items-start gap-4 mt-8 md:mt-12">
            <input
              type="text"
              placeholder="Enter Video URL here..."
              className="bg-gray-900 text-white placeholder-gray-500 p-4 px-6 rounded-full w-full md:w-2/3 block border border-gray-800 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 transition"
              onChange={(e) => setUrl(e.target.value.trim())}
              value={url}
              onKeyDown={handleSubmit}
            />
            <div
              className="rounded-full p-4 px-8 bg-white cursor-pointer text-black font-bold text-center w-full md:w-auto hover:bg-gray-200 transition"
              onClick={handleSubmit}
            >
              {isLoading ? "Fetching..." : "Fetch Video"}
            </div>
          </div>
          
          {error && (
            <p className="text-red-600 font-bold mt-4">
              Failed to fetch video info. Please check the URL and try again.
            </p>
          )}

          {detail && (
            <div className="mt-10 bg-gray-900 border border-gray-800 rounded-3xl p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 shadow-inner">
              {/* Thumbnail & Title */}
              <div className="flex flex-col gap-4">
                <img
                  src={data?.data?.thumbnail}
                  className="w-full aspect-video object-cover rounded-2xl shadow-lg border border-gray-800"
                  alt="thumbnail"
                />
                <h1 className="text-xl md:text-2xl font-bold text-white line-clamp-2 leading-tight">
                  {data?.data?.title}
                </h1>
              </div>

              {/* Download Controls */}
              <div className="flex flex-col gap-4 justify-center">
                
                {/* Default Download Buttons */}
                <div className="flex gap-3">
                  <button 
                    onClick={() => handleDownload(true, false)}
                    className="flex-1 bg-white hover:bg-gray-200 text-black font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-2 transition shadow-lg"
                  >
                    <Download size={20} /> Download Highest Quality
                  </button>
                  <button 
                    onClick={() => handleDownload(true, true)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition shadow-lg"
                  >
                    <Archive size={20} /> Add to Queue
                  </button>
                </div>

                {/* Trimming Toggle */}
                <button 
                  onClick={() => setIsTrimming(!isTrimming)}
                  className="mt-4 text-gray-400 font-medium flex items-center justify-center gap-2 hover:text-white transition"
                >
                  <Scissors size={18} />
                  {isTrimming ? "Disable Trimming" : "Trim Video Snippet"}
                </button>

                {isTrimming && (
                  <div className="mt-4 p-5 bg-gray-950 rounded-xl border border-gray-800 flex flex-col gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex justify-between items-center mb-2">
                      <input 
                        className="font-bold text-white bg-gray-900 px-3 py-2 rounded-lg shadow-inner border border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-600 w-24 text-center"
                        value={startInput}
                        onChange={(e) => setStartInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={() => {
                          const s = parseTime(startInput);
                          setStartTime(s);
                          setStartInput(formatTime(s));
                        }}
                      />
                      <input 
                        className="font-bold text-gray-700 bg-white px-3 py-1 rounded-lg shadow-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-24 text-center"
                        value={endInput}
                        onChange={(e) => setEndInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={() => {
                          const eTime = parseTime(endInput);
                          setEndTime(eTime);
                          setEndInput(formatTime(eTime));
                        }}
                      />
                    </div>
                    
                    <div className="px-2 pb-2">
                      <Slider 
                        range 
                        min={0} 
                        max={data?.data?.duration || 100} 
                        value={[startTime, endTime]} 
                        onChange={(val) => { 
                          setStartTime(val[0]); 
                          setEndTime(val[1]); 
                          setStartInput(formatTime(val[0]));
                          setEndInput(formatTime(val[1]));
                        }} 
                        styles={{
                          track: { backgroundColor: '#4f46e5', height: 8 },
                          handle: { borderColor: '#4f46e5', height: 20, width: 20, marginTop: -6, backgroundColor: '#fff', opacity: 1, boxShadow: '0 2px 4px rgba(0,0,0,0.2)' },
                          rail: { backgroundColor: '#e5e7eb', height: 8 }
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Advanced Settings Toggle */}
                <button 
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="mt-2 text-gray-700 font-semibold flex items-center justify-center gap-2 hover:text-indigo-800 transition"
                >
                  <Settings size={18} />
                  {showAdvanced ? "Hide Advanced Settings" : "Custom Mix / Advanced Settings"}
                  {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>

                {/* Advanced Settings Panel */}
                {showAdvanced && (
                  <div className="mt-4 p-5 bg-gray-950 rounded-xl border border-gray-800 flex flex-col gap-5 animate-in fade-in slide-in-from-top-4 duration-300">
                    
                    {/* Video Row */}
                    <div className="flex flex-col gap-2">
                      <button 
                        onClick={() => setIncludeVideo(!includeVideo)}
                        className={`w-full flex items-center justify-between p-3.5 rounded-xl font-bold transition border ${includeVideo ? 'bg-gray-800 text-white border-gray-700' : 'bg-gray-900 text-gray-500 border-gray-800 hover:bg-gray-800'}`}
                      >
                        <div className="flex items-center gap-2">
                          <Video size={20} />
                          {includeVideo ? "Video Enabled" : "Video Disabled (Click to Enable)"}
                        </div>
                        {includeVideo ? <Check size={20} className="text-green-600" /> : <X size={20} className="text-red-500" />}
                      </button>
                      <select 
                        disabled={!includeVideo}
                        value={selectedVideo}
                        onChange={(e) => setSelectedVideo(e.target.value)}
                        className="w-full p-3.5 rounded-xl border border-gray-800 bg-gray-900 text-white focus:outline-none focus:border-gray-600 disabled:opacity-50 disabled:bg-gray-950"
                      >
                        {videoFormats.map(v => (
                          <option key={v.format_id} value={v.format_id}>
                            {v.format_note} ({v.ext})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Audio Row */}
                    <div className="flex flex-col gap-2">
                      <button 
                        onClick={() => setIncludeAudio(!includeAudio)}
                        className={`w-full flex items-center justify-between p-3.5 rounded-xl font-bold transition border ${includeAudio ? 'bg-gray-800 text-white border-gray-700' : 'bg-gray-900 text-gray-500 border-gray-800 hover:bg-gray-800'}`}
                      >
                        <div className="flex items-center gap-2">
                          <Headphones size={20} />
                          {includeAudio ? "Audio Enabled" : "Audio Disabled (Click to Enable)"}
                        </div>
                        {includeAudio ? <Check size={20} className="text-green-600" /> : <X size={20} className="text-red-500" />}
                      </button>
                      <select 
                        disabled={!includeAudio}
                        value={selectedAudio}
                        onChange={(e) => setSelectedAudio(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-gray-100 bg-white"
                      >
                        {audioFormats.map(a => (
                          <option key={a.format_id} value={a.format_id}>
                            Audio Only - {a.ext}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-3 mt-2">
                      <button 
                        onClick={() => handleDownload(false, false)}
                        className="flex-1 bg-white hover:bg-gray-200 text-black font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-2 transition"
                      >
                        <Download size={20} />
                        Download {includeVideo && includeAudio ? "Combined" : includeVideo ? "Video" : "Audio"}
                      </button>
                      <button 
                        onClick={() => handleDownload(false, true)}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-2 transition"
                      >
                        <Archive size={20} />
                        Add to Queue
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          ) : (
            <div className="flex flex-col items-center mt-4 pb-10">
              <h1 className="text-white text-4xl md:text-6xl text-center font-extrabold tracking-tight mt-2 mb-4">
                Playlist <span className="text-gray-400">Calculator.</span>
              </h1>
              <p className="text-gray-400 text-center mb-10 text-lg">
                Find out exactly how long it takes to binge your favorite playlist!
              </p>

              <div className="flex flex-col md:flex-row items-center justify-center gap-4 w-full max-w-2xl">
                <input
                  type="text"
                  placeholder="Paste YouTube Playlist URL..."
                  className="bg-gray-900 text-white placeholder-gray-500 p-4 px-6 rounded-full w-full block border border-gray-800 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 transition shadow-inner"
                  onChange={(e) => setPlaylistUrl(e.target.value.trim())}
                  value={playlistUrl}
                  onKeyDown={(e) => e.key === 'Enter' && handlePlaylistSubmit()}
                />
                <button
                  className="rounded-full p-4 px-8 bg-white font-bold cursor-pointer text-black text-center w-full md:w-auto hover:bg-gray-200 transition shadow-lg whitespace-nowrap"
                  onClick={handlePlaylistSubmit}
                >
                  {isPlaylistLoading ? "Calculating..." : "Calculate"}
                </button>
              </div>

              {playlistError && (
                <p className="text-red-600 bg-red-100/80 px-4 py-2 rounded-lg font-bold mt-6">
                  Failed to fetch playlist info. Is the playlist public?
                </p>
              )}

              {playlistData && (
                <div className="mt-10 bg-gray-900 rounded-[2rem] p-8 md:p-12 w-full max-w-2xl border border-gray-800 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="flex flex-col gap-2 items-center text-center">
                    <span className="bg-gray-800 text-gray-300 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 border border-gray-700">Analysis Complete</span>
                    <h2 className="text-3xl font-extrabold text-white line-clamp-2 leading-tight">{playlistData.title}</h2>
                    <p className="text-gray-400 font-medium mt-1 text-lg">by {playlistData.channel}</p>
                    
                    {/* Advanced Settings */}
                    <div className="w-full bg-gray-950 rounded-2xl p-6 mt-8 border border-gray-800 shadow-inner flex flex-col md:flex-row gap-6 justify-between">
                      <div className="flex flex-col text-left flex-1">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Start Video</label>
                        <input type="number" min={1} max={playlistData.durations.length} className="bg-gray-900 text-white p-3 rounded-xl border border-gray-800 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 w-full text-sm transition" placeholder="1" value={playlistStart} onChange={(e) => setPlaylistStart(e.target.value)} />
                      </div>
                      <div className="flex flex-col text-left flex-1">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">End Video</label>
                        <input type="number" min={1} max={playlistData.durations.length} className="bg-white p-2 rounded-lg border-gray-200 outline-none w-full text-sm" placeholder={playlistData.durations.length} value={playlistEnd} onChange={(e) => setPlaylistEnd(e.target.value)} />
                      </div>
                      <div className="flex flex-col text-left flex-1">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Speed</label>
                        <select className="bg-white p-2 rounded-lg border-gray-200 outline-none w-full text-sm" value={playbackSpeed} onChange={(e) => setPlaybackSpeed(e.target.value)}>
                          <option value="0.5">0.5x</option>
                          <option value="1">1x (Normal)</option>
                          <option value="1.25">1.25x</option>
                          <option value="1.5">1.5x</option>
                          <option value="1.75">1.75x</option>
                          <option value="2">2x</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6 w-full mt-8">
                      <div className="bg-gray-950 border border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-center shadow-sm">
                        <span className="text-4xl font-extrabold text-white">{getCalculatedVideoCount()}</span>
                        <span className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-2">Videos</span>
                      </div>
                      <div className="bg-white/80 rounded-xl p-4 flex flex-col items-center shadow-sm">
                        <span className="text-4xl font-extrabold text-white">{formatDuration(getCalculatedDuration())}</span>
                        <span className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-2">Total Time</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;

import { useState } from "react";
import { Download, Settings, Video, Headphones, ChevronDown, ChevronUp, Check, X } from "lucide-react";

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
  
  const [selectedVideo, setSelectedVideo] = useState("");
  const [selectedAudio, setSelectedAudio] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const apiUrl = "http://localhost:3000";

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

  const handleDownload = (isDefault = true) => {
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
    }

    try {
      const query = new URLSearchParams({
        videoURL: url,
        format_id: finalFormat,
        ext: ext,
        title: data?.data?.title || "Video"
      }).toString();
      
      window.location.href = `${apiUrl}/downloadVideo?${query}`;
    } catch (err) {
      console.error("Error during download:", err);
    }
  };

  return (
    <>
      <div className="min-h-screen w-full bg-gradient-to-br from-blue-400 to-pink-300 flex items-center justify-center p-4">
        <div className="bg-white/20 w-full md:w-3/4 h-auto md:h-3/4 backdrop-blur-lg rounded-2xl border border-white/30 shadow-lg p-4 md:p-6">
          <h1 className="text-white text-3xl md:text-5xl text-center md:text-left font-bold mt-4">
            Your Videos, Offline Anytime
          </h1>

          <div className="flex flex-col md:flex-row items-center md:items-start gap-4 mt-6 md:mt-10">
            <input
              type="text"
              placeholder="Enter Video URL here..."
              className="bg-white p-3 rounded-full w-full md:w-1/2 block border-0 focus:outline-0"
              onChange={(e) => setUrl(e.target.value.trim())}
              value={url}
              onKeyDown={handleSubmit}
            />
            <div
              className="rounded-full p-3 px-6 bg-amber-500 cursor-pointer text-white text-center w-full md:w-auto hover:bg-amber-600 transition"
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
            <div className="mt-6 bg-white/40 rounded-xl p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-6 shadow-sm">
              {/* Thumbnail & Title */}
              <div className="flex flex-col gap-4">
                <img
                  src={data?.data?.thumbnail}
                  className="w-full aspect-video object-cover rounded-lg shadow-md"
                  alt="thumbnail"
                />
                <h1 className="text-lg md:text-xl font-bold text-gray-800 line-clamp-2">
                  {data?.data?.title}
                </h1>
              </div>

              {/* Download Controls */}
              <div className="flex flex-col gap-4 justify-center">
                
                {/* BIG Default Download Button */}
                <button 
                  onClick={() => handleDownload(true)}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition shadow-lg transform hover:-translate-y-1"
                >
                  <Download size={24} />
                  Download Highest Quality (Combined)
                </button>

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
                  <div className="mt-4 p-4 bg-white/60 rounded-xl border border-white/40 flex flex-col gap-5 animate-in fade-in slide-in-from-top-4 duration-300">
                    
                    {/* Video Row */}
                    <div className="flex flex-col gap-2">
                      <button 
                        onClick={() => setIncludeVideo(!includeVideo)}
                        className={`w-full flex items-center justify-between p-3 rounded-lg font-bold transition border ${includeVideo ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
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
                        className="w-full p-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-gray-100 bg-white"
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
                        className={`w-full flex items-center justify-between p-3 rounded-lg font-bold transition border ${includeAudio ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
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

                    <button 
                      onClick={() => handleDownload(false)}
                      className="w-full mt-2 bg-gray-800 hover:bg-black text-white font-bold py-4 px-4 rounded-lg flex items-center justify-center gap-2 transition"
                    >
                      <Download size={20} />
                      Download {includeVideo && includeAudio ? "Combined File" : includeVideo ? "Video Only" : "Audio Only"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;

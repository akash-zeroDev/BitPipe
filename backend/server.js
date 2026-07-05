import express from "express";
import cors from "cors";
import ytdl from "yt-dlp-exec";
import progressEstimator from "progress-estimator";
import ffmpegPathDefault from "ffmpeg-static";

const ffmpegPath = typeof ffmpegPathDefault === 'string' ? ffmpegPathDefault : ffmpegPathDefault.default || ffmpegPathDefault.path || ffmpegPathDefault;

const app = express();
const logger = progressEstimator();
app.use(
  cors({
    origin: "http://localhost:8000",
    credentials: true,
  })
);
app.use(express.json());
const port = process.env.PORT || 3000;



app.post("/getVideoInfo", async (req, res) => {
  try {
    const url = req.body.videoURL;
    let info;
    try {
      // 1. Try without cookies first (bypasses bot protection for 99% of public videos)
      const infoPromise = ytdl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        jsRuntimes: 'node',
      });
      info = await logger(infoPromise, `Obtaining ${url} (No Cookies)`);
    } catch (err) {
      console.log("Failed without cookies, attempting fallback with cookies...");
      // 2. Fallback to cookies ONLY if the video is restricted and requires authentication
      const infoPromiseCookies = ytdl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        cookies: "cookies.txt",
        jsRuntimes: 'node',
      });
      info = await logger(infoPromiseCookies, `Obtaining ${url} (With Cookies)`);
    }

    res.json({
      message: "Request received successfully",
      data: info,
    });
  } catch (error) {
    res.status(500);
    console.log(error);
    res.send(error);
  }
});

app.all("/downloadVideo", (req, res) => {
  try {
    const videoURL = req.body?.videoURL || req.query.videoURL;
    const formatId = req.body?.format?.format_id || req.query.format_id;
    const videoTitle = req.body?.title || req.query.title;
    const fileExtension = req.body?.format?.ext || req.query.ext;

    const startDownload = (useCookies) => {
      const options = {
        format: formatId,
        output: '-',
        jsRuntimes: 'node',
      };

      // Only use FFmpeg for streaming if we actually need to merge multiple streams
      if (formatId.includes('+')) {
        options.downloader = 'ffmpeg';
        options.ffmpegLocation = ffmpegPath;
        options.mergeOutputFormat = 'mkv'; 
      }
      if (useCookies) {
        options.cookies = "cookies.txt";
      }

      console.log(`Starting yt-dlp with options:`, options);
      const downloadProcess = ytdl.exec(videoURL, options);
      let startedSending = false;

      // Pipe output directly to user
      downloadProcess.stdout.on('data', (chunk) => {
        if (!startedSending) {
          if (!res.headersSent) {
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${videoTitle}.${fileExtension}"`
            );
            res.setHeader("Content-Type", `video/${fileExtension}`);
          }
          startedSending = true;
        }
      });
      downloadProcess.stdout.pipe(res, { end: false });

      // Log errors so we know exactly why it fails!
      let errorLog = "";
      downloadProcess.stderr.on('data', (data) => {
        errorLog += data.toString();
      });

      downloadProcess.on("close", (code) => {
        if (code !== 0 && !startedSending && !useCookies) {
          console.log("Download failed without cookies, trying with cookies...");
          startDownload(true);
        } else if (code !== 0) {
          console.error(`Download process exited with error code: ${code}`);
          console.error(`Full error log: ${errorLog}`);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              message: `Download failed with exit code ${code}. Check server logs.`,
            });
          } else {
            res.end(); // Ensure we close the connection if headers were sent
          }
        } else {
          console.log("Download completed successfully.");
          res.end();
        }
      });

      downloadProcess.on("error", (err) => {
        console.error("Error during download process:", err);
        if (!startedSending && !useCookies) {
           startDownload(true);
        } else {
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Download failed." });
          } else {
            res.end();
          }
        }
      });
    };

    startDownload(false);
  } catch (error) {
    console.error("Failed to initiate download:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to start the download.",
      });
    } else {
      res.end();
    }
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port http://localhost:${port}`);
});

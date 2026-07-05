import express from "express";
import cors from "cors";
import ytdl from "yt-dlp-exec";
import progressEstimator from "progress-estimator";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import ffmpegPathDefault from "ffmpeg-static";
import { ZipArchive } from "archiver";

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
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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
    let fileExtension = req.body?.format?.ext || req.query.ext;

    const startTime = req.body?.startTime || req.query.startTime;
    const endTime = req.body?.endTime || req.query.endTime;
    const isTrimming = startTime !== undefined && endTime !== undefined;
    const isMerging = formatId.includes('+');

    if (isTrimming || isMerging) fileExtension = 'mkv';

    const startDownload = (useCookies) => {
      const options = {
        format: formatId,
        output: '-',
        jsRuntimes: 'node',
        httpChunkSize: '10M'
      };

      if (startTime && endTime) {
        options.downloadSections = `*${startTime}-${endTime}`;
        options.forceKeyframesAtCuts = true;
      }

      if (isMerging || isTrimming) {
        options.downloader = 'ffmpeg';
        options.ffmpegLocation = ffmpegPath;
        if (isMerging) options.mergeOutputFormat = 'mkv';
        if (isTrimming) options.remuxVideo = 'mkv';
      }
      if (useCookies) {
        options.cookies = "cookies.txt";
      }

      console.log(`Starting yt-dlp with options:`, options);

      if (isTrimming) {
        delete options.output;
        const tempFile = path.join(os.tmpdir(), crypto.randomUUID() + `.${fileExtension}`);
        options.output = tempFile;

        const downloadProcess = ytdl.exec(videoURL, options);
        let errorLog = "";
        downloadProcess.stderr.on('data', (data) => { errorLog += data.toString(); });

        downloadProcess.on("close", (code) => {
          if (code !== 0 && !useCookies) {
            console.log("Trim failed without cookies, trying with cookies...");
            startDownload(true);
          } else if (code !== 0 || !fs.existsSync(tempFile)) {
            console.error(`Trim process failed. Code: ${code}. Log: ${errorLog}`);
            if (!res.headersSent) res.status(500).json({ success: false, message: "Trim failed." });
            else res.end();
          } else {
            if (!res.headersSent) {
              res.setHeader("Content-Disposition", `attachment; filename="${videoTitle}.${fileExtension}"`);
              res.setHeader("Content-Type", `video/${fileExtension}`);
            }
            const stream = fs.createReadStream(tempFile);
            stream.pipe(res);
            stream.on('end', () => fs.unlink(tempFile, () => {}));
            stream.on('error', () => fs.unlink(tempFile, () => {}));
          }
        });
      } else {
        const downloadProcess = ytdl.exec(videoURL, options);
        let startedSending = false;

        downloadProcess.stdout.on('data', (chunk) => {
          if (!startedSending) {
            if (!res.headersSent) {
              res.setHeader("Content-Disposition", `attachment; filename="${videoTitle}.${fileExtension}"`);
              res.setHeader("Content-Type", `video/${fileExtension}`);
            }
            startedSending = true;
          }
        });
        downloadProcess.stdout.pipe(res, { end: false });

        let errorLog = "";
        downloadProcess.stderr.on('data', (data) => { errorLog += data.toString(); });

        downloadProcess.on("close", (code) => {
          if (code !== 0 && !startedSending && !useCookies) {
            console.log("Download failed without cookies, trying with cookies...");
            startDownload(true);
          } else if (code !== 0) {
            console.error(`Download process exited with error code: ${code}`);
            if (!res.headersSent) res.status(500).json({ success: false, message: "Download failed." });
            else res.end();
          } else {
            res.end();
          }
        });
      }

        
      
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

const jobs = new Map();

function broadcastProgress(job) {
  const data = `data: ${JSON.stringify({ status: job.status, progress: job.progress, total: job.total, currentTitle: job.currentTitle })}\n\n`;
  job.sseClients.forEach(client => client.write(data));
}

app.get("/progress", (req, res) => {
  const jobId = req.query.jobId;
  const job = jobs.get(jobId);
  
  if (!job) return res.status(404).send("Job not found");

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  job.sseClients.push(res);

  res.write(`data: ${JSON.stringify({ status: job.status, progress: job.progress, total: job.total, currentTitle: job.currentTitle })}\n\n`);

  req.on('close', () => {
    job.sseClients = job.sseClients.filter(client => client !== res);
  });
});

app.get("/downloadJob/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'completed' || !fs.existsSync(job.zipPath)) {
    return res.status(404).send("Job ZIP not found or not completed.");
  }

  res.download(job.zipPath, "BitPipe_Batch.zip", (err) => {
    if (err) console.error("Error sending file:", err);
    fs.unlink(job.zipPath, () => {});
    jobs.delete(req.params.id);
  });
});
app.post("/downloadBatch", async (req, res) => {
  try {
    let items = [];
    if (req.body.items) {
      items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items;
    }
    
    if (!items || items.length === 0) {
      return res.status(400).send("Queue is empty.");
    }

    const jobId = crypto.randomUUID();
    const zipPath = path.join(os.tmpdir(), `BitPipe_Batch_${jobId}.zip`);

    const job = {
      status: 'processing',
      progress: 0,
      total: items.length,
      currentTitle: 'Initializing...',
      zipPath: zipPath,
      sseClients: []
    };
    jobs.set(jobId, job);

    res.json({ success: true, jobId });

    (async () => {
      try {
        const output = fs.createWriteStream(zipPath);
        const archive = new ZipArchive({ zlib: { level: 0 } });
        archive.pipe(output);

        archive.on('error', function(err) {
          throw err;
        });

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          job.progress = i;
          job.currentTitle = item.title || `Video ${i+1}`;
          broadcastProgress(job);

          const formatId = item.format_id;
          const startTime = item.startTime;
          const endTime = item.endTime;
          const isMerging = formatId.includes('+');
          const isTrimming = startTime !== undefined && endTime !== undefined;

          const options = {
            format: formatId,
            output: '-',
            jsRuntimes: 'node',
            httpChunkSize: '10M'
          };

          if (isTrimming) {
            options.downloadSections = `*${startTime}-${endTime}`;
            options.forceKeyframesAtCuts = true;
          }
          
          if (isMerging || isTrimming) {
            options.downloader = 'ffmpeg';
            options.ffmpegLocation = ffmpegPath;
            if (isMerging) options.mergeOutputFormat = 'mkv';
            if (isTrimming) options.remuxVideo = 'mkv';
          }
          
          let finalExt = item.ext;
          if (isTrimming || isMerging) finalExt = 'mkv';
          
          const safeTitle = (item.title || "Video").replace(/[/\\?%*:|"<>]/g, '-');
          const fileName = `${safeTitle}_${i+1}.${finalExt}`;
          
          console.log(`Zipping item ${i+1}:`, item.videoURL);
          
          await new Promise((resolve) => {
            if (isTrimming) {
              delete options.output;
              const tempFile = path.join(os.tmpdir(), crypto.randomUUID() + `.${finalExt}`);
              options.output = tempFile;

              const downloadProcess = ytdl.exec(item.videoURL, options);
              downloadProcess.on('close', (code) => {
                if (code === 0 && fs.existsSync(tempFile)) {
                  const stream = fs.createReadStream(tempFile);
                  archive.append(stream, { name: fileName });
                  stream.on('end', () => fs.unlink(tempFile, () => {}));
                  stream.on('error', () => fs.unlink(tempFile, () => {}));
                } else {
                  console.error(`Item ${i+1} trim failed.`);
                }
                resolve();
              });
              downloadProcess.on('error', (err) => {
                console.error(`Item ${i+1} process error:`, err);
                resolve(); 
              });
            } else {
              const downloadProcess = ytdl.exec(item.videoURL, options);
              archive.append(downloadProcess.stdout, { name: fileName });
              
              downloadProcess.on('close', (code) => {
                if (code !== 0) console.error(`Item ${i+1} failed with code ${code}`);
                resolve();
              });
              downloadProcess.on('error', (err) => {
                console.error(`Item ${i+1} process error:`, err);
                resolve(); 
              });
            }
          });
        }

        archive.finalize();

        output.on('close', () => {
          job.progress = items.length;
          job.status = 'completed';
          job.currentTitle = 'Finished!';
          broadcastProgress(job);
        });

      } catch (error) {
        console.error("Batch download failed:", error);
        job.status = 'error';
        job.currentTitle = 'Error occurred';
        broadcastProgress(job);
      }
    })();

  } catch (error) {
    console.error("Batch POST failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port http://localhost:${port}`);
});

// Triggering production deployment

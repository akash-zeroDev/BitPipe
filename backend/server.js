import express from "express";
import { execFile } from "child_process";
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
    origin: function (origin, callback) {
      callback(null, true);
    },
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

      if (isMerging || isTrimming) {
        options.ffmpegLocation = ffmpegPath;
        if (isMerging) options.mergeOutputFormat = 'mkv';
      }
      if (useCookies) {
        options.cookies = "cookies.txt";
      }

      console.log(`Starting yt-dlp with options:`, options);

      if (isTrimming || isMerging) {
        delete options.output;
        const tempDir = path.join(os.tmpdir(), crypto.randomUUID());
        fs.mkdirSync(tempDir);
        options.output = path.join(tempDir, 'video.%(ext)s');
        
        const downloadProcess = ytdl.exec(videoURL, options);
        let errorLog = "";
        downloadProcess.stderr.on('data', (data) => { errorLog += data.toString(); });

        downloadProcess.on("close", (code) => {
          let downloadedFile = null;
          if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            if (files.length > 0) downloadedFile = path.join(tempDir, files[0]);
          }

          if (code !== 0 && !useCookies) {
            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            console.log("Trim failed without cookies, trying with cookies...");
            startDownload(true);
          } else if (code !== 0 || !downloadedFile) {
            console.error(`Trim process failed. Code: ${code}. Log: ${errorLog}`);
            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            if (!res.headersSent) res.status(500).json({ success: false, message: "Trim failed." });
            else res.end();
          } else {
            if (isTrimming) {
              const trimmedTempFile = path.join(tempDir, 'trimmed.' + fileExtension);
              execFile(ffmpegPath, ['-y', '-i', downloadedFile, '-ss', startTime.toString(), '-to', endTime.toString(), '-c', 'copy', trimmedTempFile], (err, stdout, stderr) => {
                if (err) {
                  console.error("FFMPEG Trim Error:", err, stderr);
                  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
                  if (!res.headersSent) res.status(500).json({ success: false, message: "Trim failed." });
                  else res.end();
                } else {
                  if (!res.headersSent) {
                    res.setHeader("Content-Disposition", `attachment; filename="${videoTitle}.${fileExtension}"`);
                    res.setHeader("Content-Type", `video/${fileExtension}`);
                  }
                  const stream = fs.createReadStream(trimmedTempFile);
                  stream.pipe(res);
                  stream.on('end', () => { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); });
                  stream.on('error', () => { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); });
                }
              });
            } else {
              if (!res.headersSent) {
                res.setHeader("Content-Disposition", `attachment; filename="${videoTitle}.${fileExtension}"`);
                res.setHeader("Content-Type", `video/${fileExtension}`);
              }
              const stream = fs.createReadStream(downloadedFile);
              stream.pipe(res);
              stream.on('end', () => fs.rmSync(tempDir, { recursive: true, force: true }));
              stream.on('error', () => fs.rmSync(tempDir, { recursive: true, force: true }));
            }
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

          let finalExt = item.ext;
          if (isMerging) finalExt = 'mkv';
          
          const safeTitle = (item.title || "Video").replace(/[/\\?%*:|"<>]/g, '-');
          const fileName = `${safeTitle}_${i+1}.${finalExt}`;
          
          console.log(`Zipping item ${i+1}:`, item.videoURL);
          
          let tempDir = null;
          
          try {
            await new Promise((resolve) => {
              const options = {
                format: formatId,
                jsRuntimes: 'node',
                httpChunkSize: '10M',
                cookies: 'cookies.txt'
              };

              if (isMerging || isTrimming) {
                options.ffmpegLocation = ffmpegPath;
                if (isMerging) options.mergeOutputFormat = 'mkv';

                tempDir = path.join(os.tmpdir(), crypto.randomUUID());
                fs.mkdirSync(tempDir);
                options.output = path.join(tempDir, 'video.%(ext)s');

                const downloadProcess = ytdl.exec(item.videoURL, options);
                let ytdlErrorLog = "";
                downloadProcess.stderr.on('data', d => { ytdlErrorLog += d.toString(); });
                
                downloadProcess.on('close', (code) => {
                  try {
                    let downloadedFile = null;
                    if (fs.existsSync(tempDir)) {
                      const files = fs.readdirSync(tempDir);
                      console.log(`[Batch Item ${i+1}] tempDir contents after download:`, files);
                      if (files.length > 0) downloadedFile = path.join(tempDir, files[0]);
                    }

                    if (code === 0 && downloadedFile) {
                      if (isTrimming) {
                        const trimmedTempFile = path.join(tempDir, 'trimmed.' + finalExt);
                        execFile(ffmpegPath, ['-y', '-i', downloadedFile, '-ss', startTime.toString(), '-to', endTime.toString(), '-c', 'copy', trimmedTempFile], (err, stdout, stderr) => {
                          if (err) {
                            console.error(`Item ${i+1} trim failed:`, err, stderr);
                            resolve();
                          } else {
                            const stream = fs.createReadStream(trimmedTempFile);
                            archive.append(stream, { name: fileName });
                            stream.on('end', () => resolve());
                            stream.on('error', () => resolve());
                          }
                        });
                      } else {
                        const stream = fs.createReadStream(downloadedFile);
                        archive.append(stream, { name: fileName });
                        stream.on('end', () => resolve());
                        stream.on('error', () => resolve());
                      }
                    } else {
                      console.error(`[Batch Item ${i+1}] download failed. Code: ${code}. Extracted File: ${downloadedFile}. Log: ${ytdlErrorLog}`);
                      resolve();
                    }
                  } catch (e) {
                    console.error(`Item ${i+1} processing error:`, e);
                    resolve();
                  }
                });
                
                downloadProcess.on('error', (err) => {
                  console.error(`Item ${i+1} process error:`, err);
                  resolve(); 
                });
              } else {
                options.output = '-';
                const downloadProcess = ytdl.exec(item.videoURL, options);
                archive.append(downloadProcess.stdout, { name: fileName });
                
                downloadProcess.on('close', (code) => {
                  if (code !== 0) console.error(`Item ${i+1} failed with code ${code}`);
                  resolve();
                });
                
                downloadProcess.on('error', (err) => {
                  console.error(`Item ${i+1} stream error:`, err);
                  resolve();
                });
              }
            });
          } catch (e) {
            console.error(`Unexpected exception for item ${i+1}:`, e);
          } finally {
            if (tempDir && fs.existsSync(tempDir)) {
              try {
                fs.rmSync(tempDir, { recursive: true, force: true });
              } catch (rmErr) {
                console.error(`Failed to cleanup tempDir ${tempDir}:`, rmErr);
              }
            }
          }
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
    res.status(500).json({ success: false, message: "Server error during zip processing." });
  }
});

app.get("/getPlaylistLength", async (req, res) => {
  const { playlistURL } = req.query;
  if (!playlistURL) {
    return res.status(400).json({ success: false, message: "Missing playlist URL" });
  }

  try {
    const options = {
      dumpSingleJson: true,
      flatPlaylist: true,
      jsRuntimes: 'node',
      cookies: 'cookies.txt'
    };

    const info = await ytdl(playlistURL, options);
    
    if (!info.entries || info.entries.length === 0) {
      return res.status(404).json({ success: false, message: "No videos found in playlist." });
    }

    let totalDuration = 0;
    let videoCount = 0;
    let durations = [];

    info.entries.forEach(entry => {
      if (entry.duration) {
        totalDuration += entry.duration;
        videoCount++;
        durations.push(entry.duration);
      } else {
        durations.push(0);
      }
    });

    res.json({
      success: true,
      data: {
        title: info.title || "Unknown Playlist",
        totalDuration,
        videoCount,
        channel: info.uploader || "Unknown",
        durations
      }
    });
  } catch (error) {
    console.error("Playlist error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch playlist info." });
  }
});

const PORT = 10000;
app.listen(PORT, () => {
  console.log(`Example app listening on port http://localhost:${port}`);
});

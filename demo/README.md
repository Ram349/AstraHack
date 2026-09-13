# 90-second demo

[Watch / download the MP4](aunty-f1-by-the-bay-90s.mp4)

Captioned, silent 90-second walkthrough of the local game: the actual 3D
renderer, aerial introduction, countdown, Rapier-driven acceleration/boost,
live timer, and Aunty's actual text reactions. The recording uses scripted
control inputs and an editorial overlay of live game telemetry; it is not an
autonomous driving demonstration. Cuts restart the local grid sequence.

Captions explain Astra's engineering role. No live voice exchange or build-time
computer-use footage is represented as having been recorded in this video.
The game itself remains unchanged.

## Re-record locally

Run `node scripts/record-demo.mjs`, open `http://localhost:3040`, use a 1280×720
browser viewport, and click **Record 90-second demo** after the track loads.
Keep the tab visible until the recording-saved message appears. The local-only
server writes `.demo-capture/gameplay.webm`, which is excluded from Git.

Export with:

```sh
ffmpeg -i .demo-capture/gameplay.webm -t 90 -vf "fps=30,format=yuv420p" -c:v libx264 -preset fast -crf 26 -movflags +faststart -an demo/aunty-f1-by-the-bay-90s.mp4
```

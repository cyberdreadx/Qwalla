set -e
FF="$(cat ff.path)"
# 22 shots x 5.04s = 110.9s. Wordless: no VO bus, no sidechain, no apad needed.
IN=""; for n in $(seq 1 22); do IN="$IN -i c$n.mp4"; done
FC=""
for i in $(seq 0 21); do FC="$FC[$i:v]scale=1920:1080,setsar=1,fps=24[v$i];"; done
for i in $(seq 0 21); do FC="$FC[$i:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"; done
for i in $(seq 0 21); do FC="$FC[v$i][a$i]"; done
FC="${FC}concat=n=22:v=1:a=1[vc][ac];"
FC="$FC[vc]fade=t=in:st=0:d=1.5,fade=t=out:st=108.5:d=2.0,format=yuv420p[vout];"
FC="$FC[ac]alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=108.5:d=2.0[aout]"
$FF -hide_banner -loglevel error $IN -filter_complex "$FC" \
 -map "[vout]" -map "[aout]" -c:v libx264 -b:v 2150k -maxrate 2600k -bufsize 4500k -preset medium -t 110 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 160k -ar 48000 -movflags +faststart QDAY_EP0_act2.mp4 -y

set -e
FF="$(cat ff.path)"

# TO BE CONTINUED / つづく — a still, held silent, faded up out of black.
$FF -hide_banner -loglevel error -loop 1 -i card.png -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -t 4.0 -vf "scale=1920:1080,setsar=1,fps=24,fade=t=in:st=0.3:d=1.0" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -shortest -y cardclip.mp4

IN=""; for n in 1 2 3 4; do IN="$IN -i b$n.mp4"; done
IN="$IN -i cardclip.mp4"
FC=""
for i in 0 1 2 3; do
  FC="$FC[$i:v]scale=1920:1080,setsar=1,fps=24[v$i];"
  FC="$FC[$i:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"
done
FC="$FC[4:v]scale=1920:1080,setsar=1,fps=24[vk];[4:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[ak];"
FC="$FC[v0][a0][v1][a1][v2][a2][v3][a3][vk][ak]concat=n=5:v=1:a=1[vc][ac];"
# the room sound dies with the cut to the card — nothing carries over it
FC="$FC[vc]fade=t=in:st=0:d=1.0,fade=t=out:st=23.0:d=1.1,format=yuv420p[vout];"
FC="$FC[ac]loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=19.9:d=0.5[aout]"

$FF -hide_banner -loglevel error $IN -filter_complex "$FC" -map "[vout]" -map "[aout]" \
 -c:v libx264 -b:v 2200k -maxrate 2600k -bufsize 4500k -preset medium -t 24.1 \
 -pix_fmt yuv420p -r 24 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP1_stinger.mp4 -y

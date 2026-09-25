set -e
FF="$(cat ff.path)"

# 0.6s of pure black with silent audio — the held breath after the flash.
$FF -hide_banner -loglevel error -f lavfi -i color=c=black:s=1920x1080:r=24:d=0.6 \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -t 0.6 \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -y black.mp4

IN=""; for n in $(seq 1 22); do IN="$IN -i b$n.mp4"; done
IN="$IN -i black.mp4"

# accelerating rhythm: the three strands tighten, the flash snaps, then everything stops.
D=(5 5 5 5 5 3.6 3.6 3.6 3.6 3.6 3.6 3.6 3.6 3.6 2.2 5 4 3.6 3.6 5 5 5)

FC=""
for i in $(seq 0 21); do
  d=${D[$i]}
  FC="$FC[$i:v]trim=0:$d,setpts=PTS-STARTPTS,scale=1920:1080,setsar=1,fps=24[v$i];"
  FC="$FC[$i:a]atrim=0:$d,asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"
done
FC="$FC[22:v]scale=1920:1080,setsar=1,fps=24[vb];"
FC="$FC[22:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[ab];"

# shots 1-15, the black beat, then shots 16-22
ORDER=""
for i in $(seq 0 14); do ORDER="$ORDER[v$i][a$i]"; done
ORDER="$ORDER[vb][ab]"
for i in $(seq 15 21); do ORDER="$ORDER[v$i][a$i]"; done
FC="$FC${ORDER}concat=n=23:v=1:a=1[vc][ac];"

FC="$FC[vc]fade=t=in:st=0:d=1.5,fade=t=out:st=89.4:d=2.0,format=yuv420p[vout];"
# No dialogue anywhere in this act, so no voice bus and no ducking. Bed only.
FC="$FC[ac]loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=89.4:d=2.0[aout]"

$FF -hide_banner -loglevel error $IN -filter_complex "$FC" -map "[vout]" -map "[aout]" \
 -c:v libx264 -b:v 2200k -maxrate 2600k -bufsize 4500k -preset medium -t 91.4 \
 -pix_fmt yuv420p -r 24 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP1_act2.mp4 -y

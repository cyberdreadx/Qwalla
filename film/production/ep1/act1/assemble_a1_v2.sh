set -e
FF="$(cat ff.path)"; S=../../sync
IN=""; for n in $(seq 1 18); do IN="$IN -i b$n.mp4"; done
FC=""
for i in $(seq 0 17); do FC="$FC[$i:v]scale=1920:1080,setsar=1,fps=24[v$i];"; done
for i in $(seq 0 17); do FC="$FC[$i:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"; done
for i in $(seq 0 17); do FC="$FC[v$i][a$i]"; done
FC="${FC}concat=n=18:v=1:a=1[vc][ac];"
FC="$FC[vc]fade=t=in:st=0:d=1.2,fade=t=out:st=88.0:d=1.8,format=yuv420p[vout];"
FC="$FC[18:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=40500|40500[n0];"
FC="$FC[19:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=48500|48500[n1];"
FC="$FC[20:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=52500|52500[n2];"
FC="$FC[21:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=56000|56000[n3];"
FC="$FC[22:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=60480|60480[n4];"
FC="$FC[23:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=64300|64300[n5];"
FC="$FC[24:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=70000|70000[n6];"
FC="$FC[25:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=80640|80640[n7];"
FC="$FC[n0][n1][n2][n3][n4][n5][n6][n7]amix=inputs=8:normalize=0:duration=longest,apad=whole_dur=92[vo];"
FC="$FC[vo]asplit=2[vomix][vosc];"
FC="$FC[ac]volume=0.5[bedlo];"
FC="$FC[bedlo][vosc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=450[bed];"
FC="$FC[bed][vomix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=88.0:d=1.8[aout]"
$FF -hide_banner -loglevel error $IN \
 -i x0.wav -i x1.wav -i x2.wav -i x3_a.wav -i $S/s09.mp3 -i x3_c.wav -i x4.wav -i $S/s10.mp3 \
 -filter_complex "$FC" -map "[vout]" -map "[aout]" \
 -c:v libx264 -b:v 2200k -maxrate 2600k -bufsize 4500k -preset medium -t 90 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP1_act1_v2.mp4 -y

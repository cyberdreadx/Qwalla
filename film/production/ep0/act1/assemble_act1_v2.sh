set -e
FF="$(cat ff.path)"; S=../../sync
IN=""; for n in $(seq 1 18); do IN="$IN -i b$n.mp4"; done
FC=""
for i in $(seq 0 17); do FC="$FC[$i:v]scale=1920:1080,setsar=1,fps=24[v$i];"; done
for i in $(seq 0 17); do FC="$FC[$i:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"; done
for i in $(seq 0 17); do FC="$FC[v$i][a$i]"; done
FC="${FC}concat=n=18:v=1:a=1[vc][ac];"
FC="$FC[vc]fade=t=in:st=0:d=1.2,fade=t=out:st=88.0:d=1.8,format=yuv420p[vout];"
# unchanged lines, still staged off-face
FC="$FC[18:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=10300|10300[n0];"
FC="$FC[19:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=12200|12200[n1];"
FC="$FC[20:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=17000|17000[n2];"
FC="$FC[21:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=25600|25600[n3];"
# SYNCED shot 7  - must start on the shot's first frame
FC="$FC[22:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=30240|30240[n4];"
# e5 front, hole closed, over the unchanged shot 8
FC="$FC[23:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=35300|35300[n5];"
# SYNCED shot 9 - the verdict
FC="$FC[24:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=40320|40320[n6];"
# SYNCED shot 11 - harvest now, decrypt later ... then the rest over the inserts
FC="$FC[25:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=50400|50400[n7];"
FC="$FC[26:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=54600|54600[n8];"
# SYNCED shot 14 - twenty years of warehouses ... then the rest
FC="$FC[27:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=65520|65520[n9];"
FC="$FC[28:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=70200|70200[n10];"
FC="$FC[n0][n1][n2][n3][n4][n5][n6][n7][n8][n9][n10]amix=inputs=11:normalize=0:duration=longest,apad=whole_dur=92[vo];"
FC="$FC[vo]asplit=2[vomix][vosc];"
FC="$FC[ac]volume=0.5[bedlo];"
FC="$FC[bedlo][vosc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=450[bed];"
FC="$FC[bed][vomix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=88.0:d=1.8[aout]"
$FF -hide_banner -loglevel error $IN \
 -i e0.wav -i e1.wav -i e3.wav -i e2.wav \
 -i $S/s02.mp3 -i e5_front.wav -i $S/s03.mp3 \
 -i $S/s04.mp3 -i e6_rest.wav -i $S/s05.mp3 -i e7_rest.wav \
 -filter_complex "$FC" -map "[vout]" -map "[aout]" \
 -c:v libx264 -b:v 2200k -maxrate 2600k -bufsize 4500k -preset medium -t 90 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP0_act1_v2.mp4 -y

set -e
FF="$(cat ff.path)"
IN=""; for n in $(seq 1 12); do IN="$IN -i b$n.mp4"; done
FC=""
for i in $(seq 0 11); do FC="$FC[$i:v]scale=1920:1080,setsar=1,fps=24[v$i];"; done
for i in $(seq 0 11); do FC="$FC[$i:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"; done
for i in $(seq 0 11); do FC="$FC[v$i][a$i]"; done
FC="${FC}concat=n=12:v=1:a=1[vc][ac];"
FC="$FC[vc]fade=t=in:st=0:d=1.2,fade=t=out:st=59.3:d=1.2,format=yuv420p[vout];"
# Every line lands where no mouth can contradict it.
# e0 Yui  -> shot 5, hands-only insert        e1 Kestrel -> shot 6 backs, into 7
# e3 Kestrel -> shot 7, Yui listening          e4 Sable  -> shot 10, backlit profile
# e5 Kestrel -> shot 11, full silhouette       e6 Sable  -> shot 12, backlit profile
FC="$FC[12:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=20600|20600[n0];"
FC="$FC[13:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=25600|25600[n1];"
FC="$FC[14:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=32000|32000[n2];"
FC="$FC[15:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=46200|46200[n3];"
FC="$FC[16:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=51000|51000[n4];"
FC="$FC[17:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=55600|55600[n5];"
FC="$FC[n0][n1][n2][n3][n4][n5]amix=inputs=6:normalize=0:duration=longest,apad=whole_dur=62.5[vo];"
FC="$FC[vo]asplit=2[vomix][vosc];"
FC="$FC[ac]volume=0.5[bedlo];"
FC="$FC[bedlo][vosc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=450[bed];"
FC="$FC[bed][vomix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=59.3:d=1.2[aout]"
$FF -hide_banner -loglevel error $IN -i e0.wav -i e1.wav -i e3.wav -i e4.wav -i e5.wav -i e6.wav \
 -filter_complex "$FC" -map "[vout]" -map "[aout]" \
 -c:v libx264 -b:v 2200k -maxrate 2600k -bufsize 4500k -preset medium -t 60.4 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP1_act3.mp4 -y

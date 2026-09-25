set -e
FF="$(cat ff.path)"
IN=""; for n in $(seq 1 12); do IN="$IN -i b$n.mp4"; done
FC=""
for i in $(seq 0 11); do FC="$FC[$i:v]scale=1920:1080,setsar=1,fps=24[v$i];"; done
for i in $(seq 0 11); do FC="$FC[$i:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"; done
for i in $(seq 0 11); do FC="$FC[v$i][a$i]"; done
FC="${FC}concat=n=12:v=1:a=1[vc][ac];"
FC="$FC[vc]fade=t=in:st=0:d=1.2,fade=t=out:st=59.90:d=0.55,format=yuv420p[vout];"
# e0 -> shot 5 hands insert      e1 -> shot 6 backs, into 7
# e3 -> shot 7 Yui listening     e4 -> shot 10 wide, he is too small in frame to read lips
# e5 -> shot 11 full silhouette
# e6_prepped -> shot 12, LIP SYNCED. Must start at exactly 55440ms, the frame shot 12 begins,
#               or it drifts off the mouth Seedance generated from this same file.
FC="$FC[12:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=20600|20600[n0];"
FC="$FC[13:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=25600|25600[n1];"
FC="$FC[14:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=32000|32000[n2];"
FC="$FC[15:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=46200|46200[n3];"
FC="$FC[16:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=51000|51000[n4];"
FC="$FC[17:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=55440|55440[n5];"
FC="$FC[n0][n1][n2][n3][n4][n5]amix=inputs=6:normalize=0:duration=longest,apad=whole_dur=62.5[vo];"
FC="$FC[vo]asplit=2[vomix][vosc];"
FC="$FC[ac]volume=0.5[bedlo];"
FC="$FC[bedlo][vosc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=450[bed];"
FC="$FC[bed][vomix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=59.90:d=0.55[aout]"
$FF -hide_banner -loglevel error $IN -i e0.wav -i e1.wav -i e3.wav -i e4.wav -i e5.wav -i e6_prepped.mp3 \
 -filter_complex "$FC" -map "[vout]" -map "[aout]" \
 -c:v libx264 -b:v 2200k -maxrate 2600k -bufsize 4500k -preset medium -t 60.45 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP1_act3_v2.mp4 -y

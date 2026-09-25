set -e
FF="$(cat ff.path)"
IN=""; for n in $(seq 1 13); do IN="$IN -i b$n.mp4"; done
FC=""
for i in $(seq 0 12); do FC="$FC[$i:v]scale=1920:1080,setsar=1,fps=24[v$i];"; done
for i in $(seq 0 12); do FC="$FC[$i:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"; done
for i in $(seq 0 12); do FC="$FC[v$i][a$i]"; done
FC="${FC}concat=n=13:v=1:a=1[vc][ac];"
FC="$FC[vc]fade=t=in:st=0:d=1.2,fade=t=out:st=63.5:d=1.6,format=yuv420p[vout];"
FC="$FC[13:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=15500|15500[n0];"
FC="$FC[14:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=25500|25500[n1];"
FC="$FC[15:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=30500|30500[n2];"
FC="$FC[16:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=35500|35500[n3];"
FC="$FC[17:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=40500|40500[n4];"
FC="$FC[18:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=56000|56000[n5];"
# VO bus: NO gain boost. Lines already peak -1 to -4 dBFS.
FC="$FC[n0][n1][n2][n3][n4][n5]amix=inputs=6:normalize=0:duration=longest,apad=whole_dur=66[vo];"
FC="$FC[vo]asplit=2[vomix][vosc];"
# Clarity comes from lowering the BED, not raising the voice into a ceiling.
FC="$FC[ac]volume=0.5[bedlo];"
FC="$FC[bedlo][vosc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=450[bed];"
# No alimiter. loudnorm's own true-peak limiter handles the ceiling gently.
FC="$FC[bed][vomix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=63.5:d=1.6[aout]"
$FF -hide_banner -loglevel error $IN -i w0.wav -i w1.wav -i w2.wav -i w3.wav -i w4.wav -i w5.wav \
 -filter_complex "$FC" -map "[vout]" -map "[aout]" \
 -c:v libx264 -b:v 2600k -maxrate 3100k -bufsize 5200k -preset medium -t 65 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP1_teaser_v2.mp4 -y

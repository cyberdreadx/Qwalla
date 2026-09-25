set -e
FF="$(cat ff.path)"
# v3: a5 dropped (lit face, closed mouth, voice playing = the violation).
# Order a1 a2 a3 a4 a6 a7 a8 a9 a10 = 45.4s + 13s black.
# Every line lands on: off-screen speaker, back of head, silhouette, insert, or the one mouth-moving shot (a6).
$FF -hide_banner -loglevel error \
 -i a1.mp4 -i a2.mp4 -i a3.mp4 -i a4.mp4 -i a6.mp4 \
 -i a7.mp4 -i a8.mp4 -i a9.mp4 -i a10.mp4 \
 -f lavfi -t 13 -i color=c=black:s=1920x1080:r=24 \
 -f lavfi -t 13 -i anullsrc=channel_layout=stereo:sample_rate=48000 \
 -i d0.wav -i d1.wav -i d2.wav -i d3.wav -i d4.wav -i d5.wav -i d6.wav -i d7.wav \
 -filter_complex "\
[0:v]scale=1920:1080,setsar=1,fps=24[v0];[1:v]scale=1920:1080,setsar=1,fps=24[v1];\
[2:v]scale=1920:1080,setsar=1,fps=24[v2];[3:v]scale=1920:1080,setsar=1,fps=24[v3];\
[4:v]scale=1920:1080,setsar=1,fps=24[v4];[5:v]scale=1920:1080,setsar=1,fps=24[v5];\
[6:v]scale=1920:1080,setsar=1,fps=24[v6];[7:v]scale=1920:1080,setsar=1,fps=24[v7];\
[8:v]scale=1920:1080,setsar=1,fps=24[v8];[9:v]setsar=1,fps=24[v9];\
[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0];\
[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1];\
[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a2];\
[3:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a3];\
[4:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a4];\
[5:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a5];\
[6:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a6];\
[7:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a7];\
[8:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a8];\
[10:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a9];\
[v0][a0][v1][a1][v2][a2][v3][a3][v4][a4][v5][a5][v6][a6][v7][a7][v8][a8][v9][a9]concat=n=10:v=1:a=1[vc][ac];\
[vc]fade=t=in:st=0:d=1.0,fade=t=out:st=44.6:d=1.6,format=yuv420p[vout];\
[11:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=9000|9000[n0];\
[12:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=15600|15600[n1];\
[13:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=20600|20600[n2];\
[14:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=27000|27000[n3];\
[15:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=34000|34000[n4];\
[16:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=37900|37900[n5];\
[17:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=40800|40800[n6];\
[18:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=45800|45800[n7];\
[n0][n1][n2][n3][n4][n5][n6][n7]amix=inputs=8:normalize=0:duration=longest,volume=2.5,apad=whole_dur=59[vo];\
[vo]asplit=2[vomix][vosc];\
[ac][vosc]sidechaincompress=threshold=0.035:ratio=9:attack=15:release=420[bed];\
[bed][vomix]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=57.0:d=1.4[aout]" \
 -map "[vout]" -map "[aout]" -c:v libx264 -b:v 2900k -maxrate 3400k -bufsize 6000k -preset medium -t 58 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP0_act3_v3.mp4 -y

set -e
FF="$(cat ff.path)"
$FF -hide_banner -loglevel error \
 -ss 0 -t 3 -i s1.mp4 -i s2.mp4 -ss 0 -t 4 -i s3.mp4 -ss 0 -t 4 -i s4.mp4 \
 -ss 0 -t 3 -i s5.mp4 -i s6.mp4 -ss 0 -t 4 -i s7.mp4 -ss 0 -t 2 -i s8.mp4 \
 -i s9.mp4 -ss 0 -t 4 -i s10.mp4 -i s11.mp4 -i s12.mp4 \
 -ss 1.0 -t 5 -i title_qday.mp4 -i title_harvest.mp4 \
 -i yvo0.wav -i yvo1.wav -i yvo2.wav -i yvo3.wav -i yvo4.wav \
 -filter_complex "\
[0:v]scale=1920:1080,setsar=1,fps=24[v0];[1:v]scale=1920:1080,setsar=1,fps=24[v1];\
[2:v]scale=1920:1080,setsar=1,fps=24[v2];[3:v]scale=1920:1080,setsar=1,fps=24[v3];\
[4:v]scale=1920:1080,setsar=1,fps=24[v4];[5:v]scale=1920:1080,setsar=1,fps=24[v5];\
[6:v]scale=1920:1080,setsar=1,fps=24[v6];[7:v]scale=1920:1080,setsar=1,fps=24[v7];\
[8:v]scale=1920:1080,setsar=1,fps=24[v8];[9:v]scale=1920:1080,setsar=1,fps=24[v9];\
[10:v]scale=1920:1080,setsar=1,fps=24[v10];[11:v]scale=1920:1080,setsar=1,fps=24[v11];\
[12:v]scale=1920:1080,setsar=1,fps=24[v12];[13:v]scale=1920:1080,setsar=1,fps=24[v13];\
[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0];\
[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1];\
[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a2];\
[3:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a3];\
[4:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a4];\
[5:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a5];\
[6:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a6];\
[7:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a7];\
[8:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a8];\
[9:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a9];\
[10:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a10];\
[11:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a11];\
[12:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a12];\
[13:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a13];\
[v0][a0][v1][a1][v2][a2][v3][a3][v4][a4][v5][a5][v6][a6][v7][a7][v8][a8][v9][a9][v10][a10][v11][a11][v12][a12][v13][a13]concat=n=14:v=1:a=1[vc][ac];\
[vc]fade=t=in:st=0:d=1.0,fade=t=out:st=57.6:d=1.4,format=yuv420p[vout];\
[14:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=1000|1000[n0];\
[15:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=19500|19500[n1];\
[16:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=30000|30000[n2];\
[17:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=36200|36200[n3];\
[18:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=40000|40000[n4];\
[n0][n1][n2][n3][n4]amix=inputs=5:normalize=0:duration=longest,volume=2.4,apad=whole_dur=62[vo];\
[vo]asplit=2[vomix][vosc];\
[ac][vosc]sidechaincompress=threshold=0.035:ratio=9:attack=15:release=420[bed];\
[bed][vomix]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=57.6:d=1.4[aout]" \
 -map "[vout]" -map "[aout]" -c:v libx264 -b:v 2900k -maxrate 3400k -bufsize 6000k -preset medium -t 59 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP0_teaser.mp4 -y

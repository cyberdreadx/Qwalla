set -e
FF="$(cat ff.path)"
# 18 shots x 5.04s = 90.7s. Every line lands where the speaker's face is NOT on camera.
IN=""; for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do IN="$IN -i b$n.mp4"; done
$FF -hide_banner -loglevel error $IN \
 -i e0.wav -i e1.wav -i e2.wav -i e3.wav -i e4.wav -i e5.wav -i e6.wav -i e7.wav \
 -filter_complex "\
[0:v]scale=1920:1080,setsar=1,fps=24[v0];[1:v]scale=1920:1080,setsar=1,fps=24[v1];\
[2:v]scale=1920:1080,setsar=1,fps=24[v2];[3:v]scale=1920:1080,setsar=1,fps=24[v3];\
[4:v]scale=1920:1080,setsar=1,fps=24[v4];[5:v]scale=1920:1080,setsar=1,fps=24[v5];\
[6:v]scale=1920:1080,setsar=1,fps=24[v6];[7:v]scale=1920:1080,setsar=1,fps=24[v7];\
[8:v]scale=1920:1080,setsar=1,fps=24[v8];[9:v]scale=1920:1080,setsar=1,fps=24[v9];\
[10:v]scale=1920:1080,setsar=1,fps=24[v10];[11:v]scale=1920:1080,setsar=1,fps=24[v11];\
[12:v]scale=1920:1080,setsar=1,fps=24[v12];[13:v]scale=1920:1080,setsar=1,fps=24[v13];\
[14:v]scale=1920:1080,setsar=1,fps=24[v14];[15:v]scale=1920:1080,setsar=1,fps=24[v15];\
[16:v]scale=1920:1080,setsar=1,fps=24[v16];[17:v]scale=1920:1080,setsar=1,fps=24[v17];\
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
[14:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a14];\
[15:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a15];\
[16:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a16];\
[17:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a17];\
[v0][a0][v1][a1][v2][a2][v3][a3][v4][a4][v5][a5][v6][a6][v7][a7][v8][a8][v9][a9][v10][a10][v11][a11][v12][a12][v13][a13][v14][a14][v15][a15][v16][a16][v17][a17]concat=n=18:v=1:a=1[vc][ac];\
[vc]fade=t=in:st=0:d=1.2,fade=t=out:st=89.0:d=1.6,format=yuv420p[vout];\
[18:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=10300|10300[n0];\
[19:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=12200|12200[n1];\
[20:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=25600|25600[n2];\
[21:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=17000|17000[n3];\
[22:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=30000|30000[n4];\
[23:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=33200|33200[n5];\
[24:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=50500|50500[n6];\
[25:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=66000|66000[n7];\
[n0][n1][n2][n3][n4][n5][n6][n7]amix=inputs=8:normalize=0:duration=longest,apad=whole_dur=92[vo];\
[vo]asplit=2[vomix][vosc];\
[ac]volume=0.5[bedlo];[bedlo][vosc]sidechaincompress=threshold=0.035:ratio=9:attack=15:release=420[bed];\
[bed][vomix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=89.0:d=1.6[aout]" \
 -map "[vout]" -map "[aout]" -c:v libx264 -b:v 2900k -maxrate 3400k -bufsize 6000k -preset medium -t 90 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP0_act1_fixed.mp4 -y

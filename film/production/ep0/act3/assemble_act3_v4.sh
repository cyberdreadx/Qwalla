set -e
FF="$(cat ff.path)"; S=../../sync
# v4: a11 (synced) inserted before the black, so her last revelation has a face
# before the dark takes it. Black trimmed 13s -> 8s to keep the act the same length.
# order: a1 a2 a3 a4 a6 a7 a8 a9 a10 a11 + 8s black = 50.4 + 8 = 58.4s
IN="-i a1.mp4 -i a2.mp4 -i a3.mp4 -i a4.mp4 -i a6.mp4 -i a7.mp4 -i a8.mp4 -i a9.mp4 -i a10.mp4 -i a11.mp4"
IN="$IN -f lavfi -t 8 -i color=c=black:s=1920x1080:r=24 -f lavfi -t 8 -i anullsrc=channel_layout=stereo:sample_rate=48000"
FC=""
for i in $(seq 0 9); do FC="$FC[$i:v]scale=1920:1080,setsar=1,fps=24[v$i];"; done
for i in $(seq 0 9); do FC="$FC[$i:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a$i];"; done
FC="$FC[10:v]setsar=1,fps=24[vb];[11:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[ab];"
for i in $(seq 0 9); do FC="$FC[v$i][a$i]"; done
FC="$FC[vb][ab]concat=n=11:v=1:a=1[vc][ac];"
FC="$FC[vc]fade=t=in:st=0:d=1.2,fade=t=out:st=56.6:d=1.8,format=yuv420p[vout];"
FC="$FC[12:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=9000|9000[n0];"
FC="$FC[13:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=15600|15600[n1];"
FC="$FC[14:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=20600|20600[n2];"
FC="$FC[15:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=24300|24300[n3];"
FC="$FC[16:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=25200|25200[n4];"
FC="$FC[17:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=34000|34000[n5];"
FC="$FC[18:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=37900|37900[n6];"
FC="$FC[19:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=40320|40320[n7];"
FC="$FC[20:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=45360|45360[n8];"
FC="$FC[21:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=50300|50300[n9];"
FC="$FC[n0][n1][n2][n3][n4][n5][n6][n7][n8][n9]amix=inputs=10:normalize=0:duration=longest,apad=whole_dur=60[vo];"
FC="$FC[vo]asplit=2[vomix][vosc];"
FC="$FC[ac]volume=0.5[bedlo];"
FC="$FC[bedlo][vosc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=450[bed];"
FC="$FC[bed][vomix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=56.6:d=1.8[aout]"
$FF -hide_banner -loglevel error $IN \
 -i d0.wav -i d1.wav -i d2.wav -i d3_front.wav -i $S/s06.mp3 -i d4.wav -i d5.wav \
 -i $S/s07.mp3 -i $S/s08.mp3 -i d7_rest.wav \
 -filter_complex "$FC" -map "[vout]" -map "[aout]" \
 -c:v libx264 -b:v 2200k -maxrate 2600k -bufsize 4500k -preset medium -t 58.4 -pix_fmt yuv420p -r 24 \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart QDAY_EP0_act3_v4.mp4 -y

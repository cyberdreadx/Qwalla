# Q-DAY — anime pilot + episode one

Two ~5.5 minute episodes. 1990s hand-drawn cel style (Akira / Ghost in the Shell house look).

**Premise.** Quantum computers break public-key cryptography overnight. Every lock on
Earth opens at once — and because the same break voids digital *signatures*, not just
encryption, every nation wakes up holding perfect authenticated proof that a different
nation did it.

## Episodes

| | | Runtime |
|---|---|---|
| Episode Zero | **Q-DAY** | 5:27 |
| Episode One | **ATTRIBUTION** 帰属 | 5:31 |

`episodes/` holds both cut end to end at 720p. The 1080p masters and the ten
individual act files are not committed here — binaries are permanent in git history
and the full set is ~280 MB. To archive those, attach them to a GitHub Release
instead (Releases → Draft a new release → drag the files in).

## Structure

Each episode is teaser / three acts / stinger. Act Two of both is deliberately
wordless. Episode Zero ends on the reveal that the attack was run on purpose with a
nine-hour head start; Episode One ends on the signature attached to it, which reads
`koala` — the handle its protagonist posted her original warning under.

## Cast and voices

| Character | Voice preset |
|---|---|
| Yui Nakasone | Vera |
| Kestrel | Helena |
| Prof. Torii | Arthur |
| Cdr. Ada Voss | Nadine |
| Sable | Evan |
| Junior officer | Dylan |
| Trailer narrator | Desmond |

## How it was made

**Character consistency** comes from a bible: one character sheet and one location
plate per subject, passed as image references into every still. `production/MEDIA_IDS.txt`
maps each sheet and plate to its generation id.

**Every shot is keyframe-then-animate** — generate a still from the bible, then animate
that still. Shots are 5.04s at 1920x1080 / 24fps.

**Dialogue is authoritative and separate.** Voice lines are generated independently and
mixed in the edit. Video prompts carry an explicit ban on speech in their audio cue,
because otherwise the video model invents its own dialogue and animates lips to it while
the real line plays on top.

**Lip sync** is used on the ~15 lines that carry a scene, not on all 40. Everything else
is staged onto listeners, backs, silhouettes and inserts — which is how most real anime
plays dialogue anyway. Synced shots are generated from the recorded line itself, so the
mouth follows the performance rather than the reverse.

### Two things that will bite you again

**Prep audio before syncing it.** A line that starts at t=0.000 with no lead-in cannot
be synced — the model needs a beat to settle, so the mouth lands up to 1.3s late. Pad
0.6s of silence at the head, and trim internal dead air (the TTS reads an ellipsis as
several seconds of silence; one line had a 4.83s hole in the middle of it). A synced
shot's audio must then start on that shot's exact first frame.

**The audio chain.** Clarity comes from pulling the bed down under the voice, never from
pushing the voice up into the ceiling:

```
VO bus at unity gain — no boost. Lines already peak -1 to -4 dBFS.
  [vo] apad=whole_dur=<len+2>        # or sidechaincompress deadlocks on a starved input
  [bed] volume=0.5
  [bed][vo] sidechaincompress=threshold=0.05:ratio=8:attack=20:release=450
  amix -> loudnorm=I=-14:TP=-1.5:LRA=11
```

No `alimiter`. An earlier chain used `volume=2.5` on dialogue already peaking at -2.3 dBFS
and hard-clipped 5,185 samples flat at 0 dBFS. Verify on the **intermediate VO bus**, not
the output file — `loudnorm` rescales at the end, so a clipped and a clean master read the
same peak. The check that matters is `astats` → `Flat factor: 0.000000`.

Video models asked for silent output return **no audio stream at all**, which breaks a
concat filtergraph. Lend those shots room tone from a neighbouring shot in the same location.

## Open

- **No score.** ~11 minutes of film carried entirely on room tone, rain, sea and console hum.
- Three synced shots could not be verified by automated mouth-onset measurement (head and
  camera motion defeat the detector) and need a listen.

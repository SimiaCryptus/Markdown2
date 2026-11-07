---
title: Music
---
# Music

Short pieces of music travel as **Tartlet** sketches, declared as `text/vnd.tartlet`. Tartlet reads Strudel-style patterns: a few lines of text become drums, basslines and chords.

A sketch is never run as code. Tartlet parses it into a small, closed language and reports anything outside that language as a problem, muting only the track that has it. The player draws as soon as the page opens, but nothing sounds until you press play.

## A first sketch

<<<GROOVE type="text/vnd.tartlet" title="Groove"
setcpm(92/4)

$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
$: n("<0 2 4 6>").scale("D:minor").s("triangle").room(.4).slow(2)
GROOVE

The source is ordinary text in a resource:

```text
<<<GROOVE type="text/vnd.tartlet" title="Groove"
setcpm(92/4)
$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
GROOVE
```

- `setcpm(92/4)` sets the tempo: one cycle is a 4/4 bar at 92 beats per minute.
- Each `$:` line is one track. Tracks play together.
- Inside strings, `a b c` splits the cycle evenly, `~` is a rest, `[a b]` squeezes a group into one step and `<a b>` takes one item per cycle.

## Fenced sketches

A fenced block named `tartlet` plays the same way. Ordinary Markdown previews show it as code:

```tartlet
setcpm(124/4)
$: s("bd*4, [~ hh]*4, ~ cp ~ cp").gain(.9)
$: note("<c2 c2 eb2 g1>*2").s("sawtooth").lpf(500).release(.1)
```

## Variations

Random choices in a sketch, such as `?` drops or `sometimesBy`, are seeded, so every reader hears the same take. The `tartlet-seed` attribute picks a different one:

<<<CHANCE type="text/vnd.tartlet" title="Chance" tartlet-seed="take-2"
setcpm(124/4)
$: s("bd*4, hh*16?0.4")
$: note("c3 eb3 g3 bb3").s("triangle").degradeBy(.3).sometimesBy(.4, x => x.add(12)).release(.1)
CHANCE

## What a sketch can and cannot do

- **Checked first.** If no track of a sketch can play, the resource shows its fallback with `handler-error`. Problems in single tracks are listed in the player.
- **Sandboxed.** The player runs in a frame with an opaque origin. It cannot reach this app, its storage, your keys or the toolbar.
- **No network.** Every sound is synthesized. Sample files named with `sample(...)` are not loaded here, so those tracks stay silent with a warning.
- **Sound on request.** Audio starts only when you press play inside the player.
- **Safety.** All sound passes through a limiter that cannot be bypassed. A sketch that pulses steadily between 3 and 30 Hz shows a warning first; press play again to listen.
- **Graceful.** Until the player has loaded, and whenever it cannot, you see the sketch's source.

`text/vnd.tartlet` is a provisional name, not registered with IANA.

## Next

- [Join the community](community.md)
- [Back to the welcome page](index.md)
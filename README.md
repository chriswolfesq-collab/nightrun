# NIGHTRUN

A neon auto-runner. You always move right, you get faster the longer you live,
and the city is generated in front of you as you run. Jump, air-jump, slide,
and spend a full meter to smash straight through a stretch of it.

Static site, no build step, no dependencies. It needs to be served over HTTP
because it uses ES modules:

```bash
python3 -m http.server 5190 --directory nightrun
# open http://localhost:5190
```

## Controls

- **Desktop:** `Space` / `↑` / `W` jump — hold for height, press again in the air ·
  `↓` / `S` slide · `Shift` / `X` surge · `Esc` pause · `M` mute · `R` restart
- **Touch:** tap anywhere to jump, hold the ▼ pad (bottom left) to slide, ⚡ (bottom
  right) to surge
- Gamepad works too.

## The idea

Every endless runner generates its levels. The interesting question is what
stops it generating one you cannot survive.

The usual answer is a table of safe numbers — gaps no wider than 300px, blocks
no taller than 60 — which holds right up until the speed ramp, the height
changes and the obstacle spacing interact in a way nobody tabulated. It fails
quietly, in one seed out of a hundred, at 1400m, to one player.

Here the generator does not get to decide. Every chunk it builds is **played
before it ships**, at generation time, by a search that moves through it with
the same `physics.step()` the human uses. If no line exists, the chunk is thrown
away and rerolled. The generator proposes; the solver disposes.

That inverts the usual relationship. The templates in `generator.js` are free to
be aggressive, because being wrong is cheap and caught. And the tuning
constants in `physics.js` can be changed without re-deriving anything by hand:
the reach numbers the generator sizes its gaps from are computed from those
constants, and the validator re-plays every chunk under them.

## How it fits together

| file | |
|---|---|
| `js/physics.js` | The movement rules, and the reach they imply. The one source of truth. |
| `js/solver.js` | Given a piece of world, is there a line through it? |
| `js/generator.js` | Chunk templates, the difficulty ramp, and the reroll loop. |
| `js/game.js` | Run state: streaming, scoring, surge, death. |
| `js/render.js` | Canvas 2D. Sun, skyline, grid, glow — all procedural, no assets. |
| `js/share.js` | Challenge links, the share text, and the card. |
| `js/audio.js` | Web Audio. The bassline's tempo tracks the difficulty. |

### The physics is shared, deliberately

The solver does not model the game. It *calls* the game's `step()`, at the game's
fixed timestep, with the game's constants. There is no second implementation to
drift out of sync with the first — which is the failure mode that makes this kind
of validation worthless in practice.

Keeping that true costs a little discipline in `game.tick()`: it accumulates real
frame time and spends it in substeps of exactly `1/120`, carrying the remainder
to the next frame, rather than taking whatever slice is left over. A substep of
some other length would be simulating a game nobody is playing.

### What the solver looks for

Not "can the player reach x alive" — that goal will happily bless a course that
kills you a metre past where it stopped looking, because crossing a line mid-air
with no jumps left over a gap counts as alive. The goal is **standing on
something** at or beyond the target. That one change is what makes a line a line.

The frontier is bucketed by how far right a state has got, so the search spends
its budget going forwards. Ordinary chunks are proved in a fraction of a
millisecond; the hardest measured takes about 26k states.

## Sharing a run

A distance on its own is a boast nobody can check or answer. The course is a pure
function of its seed, so a shared run carries the seed:

```
NIGHTRUN  1,310m
🟪🟪🟪🟪🟪🟪🟪🟪⬛⬛ 💥

Beat 1,240m on this course.

31 cells · ×4 · 1 surge · 43.8s

Same city, your turn:
.../#/run/39u?d=1310
```

Opening that link runs **the same city, block for block**, with a magenta gate
standing in the world at the distance that was sent. Your own best stands there
too, in violet. Retries keep the seed — you cannot learn a city you are only
shown once — and finishing produces a link back with your own distance in it, so
a challenge can bounce between two people on one course.

The squares track the real difficulty ramp (`difficultyAt`), not an arbitrary
maximum, so retuning the pacing retunes the bar with it. Sharing goes to the
native share sheet with a rendered card where that exists, the clipboard where it
does not, and a visible textarea if both are blocked.

## The tools are the design work

```bash
node tools/stress.mjs 20      # the generator, chunk by chunk
node tools/playtest.mjs 25    # whole courses, end to end
```

**`stress.mjs`** first checks that the validator can tell good from bad at all —
a validator that says yes to everything is worse than none. It is fed courses
that are known-clearable and known-impossible and has to sort them, and each
impossible case has to be impossible for the right reason: a wall is not
unclearable just because it is taller than one jump, since the air jump reaches
313px, so the walls it is given are built past that. Only then does it get to
vouch for the real generator.

It also reports what the course actually *asks* of the player, by re-judging
every chunk with one ability switched off:

```
moveset demand   7.1% of chunks are unclearable without the air jump
                 9.4% are unclearable without sliding
```

That number found two real design failures. Slide gates were short enough to
simply jump on top of, and "chasm" gaps — the ones meant to require the air jump
— turned out to be narrower than a single jump could clear, because the reach
model had left out coyote time. Both read fine on screen. Both meant the game
had three verbs and needed one.

**`playtest.mjs`** does the same job one level up: it searches a whole streamed
course for a single line from the start to 3000m, then replays that exact input
sequence through the real `createGame()` — its tick loop, its streaming, its
collision window — and requires it to survive. If the replay dies, the game and
the thing that vouches for it have drifted apart, which is the one bug this whole
design exists to prevent.

An earlier version of this harness drove the game with a reactive bot instead.
It kept dying, and every death took a long time to attribute, because a bot that
replans every frame procrastinates: at each tick some line still exists that
starts with *do nothing*, so it takes that one, and keeps taking it until the
jump it was always going to need no longer fits. The bot was the bug more often
than the game was. Solving once and replaying has no such opinions.

## Things that are true because something caught them

- **Landing on the lip of a building is a landing.** Collision used to resolve
  horizontally before vertically, so arriving at a rooftop edge 0.02px low was a
  head-on crash into the wall rather than a landing. Vertical resolves first now,
  and the forgiveness scales with how fast you were falling — at 1500px/s you
  cross 12px in a single step, and a fixed tolerance turns that into a death.
- **Rooftop gaps were sized with the height delta inverted**, so jumps *up* got
  gaps sized as if they were drops.
- **The skyline is painted into offscreen tiles.** Drawn directly it was the best
  part of ten thousand `fillRect`s per frame for a picture that is identical
  every frame.
- **The camera frames width, not height.** Scaled to height, a portrait phone saw
  286 world pixels of course — about half a second of warning at speed.
- **Jump and slide need separate touch controls.** They cannot share one: a jump
  has to fire the instant a finger lands, and a drag can only be told apart from
  a tap after the fact, so "tap to jump, drag down to slide" jumps first every
  single time and then slides. Hence the two pads.

## Surge is the one place the guarantee stops

Everything above proves the course is clearable at the speed the run puts you at.
Surge deliberately breaks that: +32% speed for 3.2 seconds. Gaps get *easier*
(reach scales with speed) and anything breakable in the way is destroyed on
contact, so it cannot expire with you buried in a wall — but a narrow landing
platform can be overshot. That is the trade, and it is the player's to make.

### The run opens on empty road

Every run begins 1330px *behind* the start line, on a flat runway with nothing
on it — three and a half seconds at the opening speed, so the first obstacle is
still off the right of the screen when control is handed over. The runway sits
at negative x so the metres on the HUD still start at the start line: a free
three seconds that also added eighty metres to every run would have quietly
beaten everyone's old best. A player who never touches the keyboard now lives
3.9s instead of 0.4s.

The title screen's attract loop asks for `leadIn: 0` — an empty straight is the
blank backdrop it exists to avoid.

## Known limits

- Portrait phones are cramped; landscape is the better shape for this.
- The difficulty ramp tops out at 3000m. Past that the course stops escalating
  and it is purely a question of how long you can hold it together.
- Chunk validation assumes you enter a chunk on the ground. You can cross a seam
  mid-jump, which is usually an advantage and never checked.

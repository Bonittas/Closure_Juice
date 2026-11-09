Berrylane v2: scroll-driven strawberry milkshake one-pager (three.js 0.128 from CDN, no build step)

Run (ES modules need http, not file://):
  cd strawberry-site && python3 -m http.server 8000   ->  http://localhost:8000

One continuous vertical 3D world; the camera travels down through it as you scroll, so objects leave the frame
instead of fading or cutting. Text on the left, fixed transparent canvas on the right (stacked on screens <= 860px).

  1 Fresh    warm beige   bowl heaped with 53 berries, all inside the bowl (they rain in on load); the bowl tips toward you with the first scroll
  2 Tumble   golden       only the falling berries, straight down in front of the bowl; the camera falls with them
  3 Blend    pink         berries over the jar opening land in it, the rest fall past; a glass pitcher pours milk in, lid on, blades spin, turns strawberry red;
                          at the end the lid lifts, the jar rises off the base and starts to tip
  4 Pour     deep berry   only the shake stream (plus droplets), the camera rides it down
  5 Glass    mint         the stream fills the glass, then cream, syrup drips, berry, straw, condensation, berries around it
  6 Menu     chocolate    menu cards, the finished shake on a turntable (hidden on phones). Footer below.

main.js: P = story position (section index + progress). apply(P) is a pure function, so scrolling up rewinds.
Only the intro rain, blade spin and droplet shimmer use the clock. Model files are reused unchanged.
Previous versions: ../strawberry-site-v1/, ../strawberry-site-v2/.

Maleda: scroll-driven strawberry shake bar website (three.js 0.128 self-hosted, no build step, works offline)

Run (ES modules need http, not file://):
  cd strawberry-site && python3 -m http.server 8000   ->  http://localhost:8000

One continuous vertical 3D world; the camera travels down through it as you scroll, so objects leave the frame
instead of fading or cutting. Text on the left, fixed transparent canvas on the right (stacked on screens <= 860px).

  1 Fresh    warm beige   bowl heaped with 53 berries, all inside the bowl (they rain in on load); the bowl tips toward you with the first scroll
  2 Tumble   golden       only the falling berries, straight down in front of the bowl; the camera falls with them
  3 Blend    pink         ~40 berries drop into the jar and tumble (precomputed collision sim: jar wall/floor, blade hub, berry vs berry), the rest fall past; a glass pitcher pours milk in, lid on, blades spin, turns strawberry red;
                          at the end the lid lifts, the jar rises off the base and starts to tip
  4 Pour     deep berry   only the shake stream (plus droplets), the camera rides it down
  5 Glass    mint         the stream fills the glass, then cream, syrup drips, berry, straw, condensation, berries around it
  6 Menu     chocolate    menu cards, the finished shake on a turntable (hidden on phones). Footer below.

main.js: P = story position (section index + progress). apply(P) is a pure function, so scrolling up rewinds.
Only the intro rain, blade spin and droplet shimmer use the clock. Model files are reused unchanged.
After the story: why us, full menu with prices, reviews (placeholder copy: replace with real ones), gallery, visit/hours/map,
newsletter (front-end only, nothing is sent) and footer. Address and emails are generic placeholders (example domain).
og:image / twitter:image point to og-image.jpg relatively; set them to an absolute URL once the site has a domain.
physics.js: the small position-based solver used for both the bowl drop and the blender landing.

v12 load path (all files are local; no network beyond the site itself)
  vendor/three.module.js  three.js r128, patched for KHR_parallel_shader_compile (search "[maleda patch]"):
                          programs compile on the driver's threads and a draw is skipped until its program is ready.
  fonts/                  self-hosted Playfair Display + DM Sans (woff2, latin + latin-ext, font-display: swap, OFL.txt).
  sims.bin                the three physics simulations (hero drop, bowl tip, jar landing), baked offline, lossless
                          (exact float32 recordings, gzip). If it is missing or stale (signature check) the page
                          simulates live with the same code. Re-bake after changing berries/bowl/jar/physics:
                            python tools/bake.py http://localhost:8765/     (needs playwright + Chrome)
  Start-up: hero scene -> baked sims -> first frame as soon as the hero's programs are ready (loader hides) ->
  blender / pitcher / glass built in idle chunks -> remaining story beats warmed up offscreen, one per frame.
  Below the story the canvas is hidden and nothing is rendered.
  Debug flags: ?nobake (live physics), ?nopsc (blocking shader compile), ?bench (benchmark harness).

v13
  Serve locally:  double-click serve.bat (or: python serve.py) -> opens http://127.0.0.1:8765/
                  Use 127.0.0.1, not localhost: on Windows "localhost" may be tried as IPv6 first and plain
                  "python -m http.server" also does a name lookup at start; both can add seconds to the first request.
  Start-up (behind the loader, on the real canvas): hero shaders compile in parallel and are drawn once -> later
  sections are built in idle chunks -> every story beat is drawn once (time-boxed to 7 s; leftovers are drawn in spare
  frames afterwards) -> the first real frame, loader hides. Software GL (SwiftShader/llvmpipe) skips the beat warm-up.
  Adaptive quality: "lite" on old/software GPUs (renderer string) or when the hero's shaders take >3.5 s to build:
  same scene, physical materials compiled without clearcoat (gloss folded into roughness/env), 1024 shadow map,
  pixel ratio <= 1.25. ?quality=full / ?quality=lite force a mode; ?warm=1 forces the warm-up on software GL.

v14 (Nov 10 2026)
- Bowl: 84 strawberries (was 53), heaped toward the middle; re-baked sims.bin (BAKE_V 13). 3 miss the blender jar, 81 land (shown slightly smaller in the jar).
- Berries are now clones of 9 shared prototypes drawn with InstancedMesh (INST in main.js): draw calls at the hero dropped from 225 to 49.
- Final glass rebuilt after the reference photo: clear tapered cup with a thin rim, vivid frosty shake filled to the rim, condensation,
  one piped cream swirl to a soft peak, glossy red syrup drizzled over the cream and dripping down the outside, berry beside the peak,
  striped straw angled right, floating berries, pink splash sheets and droplets, warm lighting, maroon section background.

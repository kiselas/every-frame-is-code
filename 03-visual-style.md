# Visual style

## Defaults to move away from

Models (both Claude and GPT) have a "house taste": a dark-blue or near-black background, teal or amber accents, bloom on everything, particles filling empty space, a centered all-caps title. All of this is legitimate if chosen deliberately. If no style is specified, derive it from the subject: materials, era, craft, the environment the video's subject lives in.

Examples of how the subject suggests a style:
- history of science: engraving, hatching, yellowed paper, sepia;
- finance and transactions: clean infographics, a grid, one accent color, precise typography;
- space and physics: doesn't have to be neon — linocut, Soviet popular-science illustration, or blueprint work too;
- children's subjects: gouache, uneven edges, warm light, large simple shapes;
- technology and code: ASCII, terminal, monochrome phosphor, halftone.

## Palettes

Build a palette of 4-6 colors with roles: background, shadow, midtone, light, accent. The accent covers no more than 5-10% of the frame area.

| Direction | Background | Shadow | Midtone | Light | Accent |
|---|---|---|---|---|---|
| Engraving | #efe6d2 | #3b3226 | #8a7a60 | #fbf7ee | #9e2b25 |
| Filmstrip | #1c1a17 | #3d2f25 | #b88a4a | #f3e3c0 | #d6453a |
| Blueprint | #1d3557 | #13243b | #457b9d | #e8f1f7 | #f4a261 |
| Swiss poster | #f2f0eb | #111111 | #7d7d7d | #ffffff | #e3242b |
| Night city | #0b0d17 | #1a1f35 | #4a4e8c | #f2e9ff | #ff3d7f |
| Forest fog | #cfd8cf | #2e3b33 | #6f8a73 | #eef2ea | #d9a441 |
| Phosphor | #020402 | #0a1a0a | #1f7a1f | #b6ffb6 | #ffffff |

Rule: shadows aren't black — they're a dark variant of the color complementary to the light. Warm light gives cool shadows, and vice versa.

## Light

- One key light source, coming from somewhere specific. All lighting, highlights, and shadows agree with it.
- Rim light separates the subject from the background better than any outline. In 2D, this is a bright edge on the side facing away from the viewer.
- Build glow in two layers: a dense bright core plus a wide, faint halo. A single blurred copy looks flat.
- Distribute brightness deliberately: there is exactly one brightest spot in the frame, and that's where the viewer looks.

## Composition

- Rule of thirds and the golden ratio as anchor points for the main subject; center placement only for symmetrical, ceremonial frames.
- Negative space is part of the composition. Empty space around a subject gives it weight.
- Leading lines (roads, rays, edges) draw the eye toward the subject.
- Depth: at least three planes. Foreground (blurred, dark, fast-moving), midground (the subject), background (lighter, lower contrast, slow-moving). Aerial perspective: distant elements are lighter and closer to the color of the sky.
- Scale: place something small next to something huge (a figure, a house, a bird), otherwise size doesn't read.

## Texture

Clean vector looks like a slide deck. What gives it a "handmade" feel:
- seeded line jitter;
- line boil: the jitter changes 8-12 times per second, not every frame, the way hand-drawn animation does;
- film grain (07-effects-cookbook.md);
- uneven fill: noise in the alpha channel, or color offset driven by fbm;
- paper: faint noise and a vignette on the background;
- hatching instead of gradients for shadows.

## Color grading

A final pass over the frame. In WebGL this is a shader; in 2D it's `ctx.filter` or a separate buffer.
- Tonemapping (ACES or filmic) makes bright areas soft rather than blown out.
- Split toning: shadows shifted toward one hue, highlights toward another (the classic: teal shadows, warm highlights).
- A slight desaturation in the shadows.
- Vignette at 10-25%.

```glsl
vec3 aces(vec3 x){ const float a=2.51,b=.03,c=2.43,d=.59,e=.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.,1.); }
vec3 splitTone(vec3 c, vec3 shadow, vec3 highlight){
  float l = dot(c, vec3(.2126,.7152,.0722));
  return c + mix(shadow, highlight, smoothstep(.2,.8,l)) * .08;
}
```

## Style check

Before writing code, pin down: 4-6 colors with roles, 1-2 fonts, a light source, three depth planes, one bold choice. Mentally run a similar prompt through the same setup: if you'd get the same result, the style isn't tied to the subject closely enough.

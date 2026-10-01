# Lyapunov: script (version 2, voiced)

A 60-second vertical film with a voice-over and subtitles, in Russian, about the mathematician Alexey Lyapunov, for his birthday (8 October). It is the first video made on the line of [23-short-factory.md](../../23-short-factory.md): everything lives in [spec.json](spec.json) and [voice.txt](voice.txt), and one command builds it.

```bash
node render/make.mjs examples/lyapunov/spec.json --draft     # about a minute: lint, voice, page, draft render, review
node render/make.mjs examples/lyapunov/spec.json             # final render, review, captions.srt, cover, post.md, an upload-size export
```

The output goes to `out/` (git-ignored): `lyapunov.mp4`, `film.html` (open it in Chrome for the live preview with sound), `captions.srt/.vtt`, `cover.jpg`, `post.md`, `qa/report.md`, `exports/lyapunov-upload.mp4`. The first version (silent, hand-drawn) is in [v1/](v1/) and is the "before" of the critique in [21-infographics.md](../../21-infographics.md).

## Why version 2

The first version was judged "unclear and uninteresting". The diagnosis (chapters 20 and 21): a silent film cannot carry causes (why does a programming course in 1952 have anything to do with the fate of a word?), and five of its eleven pictures were labels in boxes. Version 2 speaks the causes, draws each picture as a claim with a yardstick, and puts the hook in the viewer's world ("a good program starts with a scheme") instead of in the dictionary.

## Specs

| | |
|---|---|
| Genre | `one-life` ([20-silent-social.md](../../20-silent-social.md)), framed as myth vs fact |
| Length | 59.8 s, 9 shots, one per voice phrase; the cuts fall into the pauses of the voice |
| Voice | Edge TTS `ru-RU-DmitryNeural`, rate −5%, 102 words, 1.71 words/s; word times calibrated to the audio |
| Text | statements 27 words, longest line 16 characters at one size (94 px); subtitles from the voice, the spoken word highlighted |
| Music | `Compose`, A minor, `tense`, seed 5, energy from the shots; ducked 12 dB under speech from the word times |
| Themes | `paper` (people, labels) and `blueprint` (the technical idea) |
| HUD | one life on a rail, 1911 to 1973; the year rewinds from 1954 to 1911 and then marches; the stamp is the motif: lands (shot 2), struck by the facts (shot 6), peels off (shot 9) |

## Shots

Each picture is a block from [runtime/blocks.js](../../runtime/blocks.js), and its moments are tied to spoken words (`{ "$word": … }`), not to seconds: change the voice and the stamp still lands on "лжеучёным".

| # | id | Voice (phrase) | Statement | Claim | Picture (what it proves) |
|---|---|---|---|---|---|
| 1 | `hook` | Хорошая программа начинается не с кода, а со схемы. | НЕ С КОДА, *СО СХЕМЫ.* | comparison | `split`: a scrolling column of code on the left, a scheme with a running token on the right |
| 2 | `label` | В СССР этому учил человек, которого в 1954-м называли лжеучёным. | В 1954-М — *ЛЖЕУЧЁНЫЙ.* | identity | `card`: a dictionary page; the stamp ЛЖЕНАУКА lands on the word |
| 3 | `who` | Алексей Ляпунов. Математик, артиллерист, ученик Лузина. | МАТЕМАТИК, *НЕ ИНЖЕНЕР.* | identity | `plate` (the name) + `rail` (his life, the war years hatched, flags on the spoken words) |
| 4 | `numbers` | В 52-м машины понимали только числа… Одна ошибка, и всё заново. | ТОЛЬКО *ЧИСЛА.* | identity | `columns`: octal codes; on "ошибка" one cell turns red |
| 5 | `scheme` | Ляпунов предложил: сначала нарисуй схему… А код пусть соберёт программа. | СНАЧАЛА *СХЕМА.* | comparison | `split`: the dead code column vs a scheme that runs a token; counters "by hand: 0" and "lines of code" counting up on "соберёт" |
| 6 | `ban` | Но слово «кибернетика» в стране считали лженаукой. | СЛОВО — *КЛЕЙМО.* | identity | `card`: the 1953 article "Кому служит кибернетика?" and the 1954 dictionary page with the stamp |
| 7 | `fight` | Он отвечал результатами: десять лет семинара, первая статья в её защиту, совет при Академии наук. | ДЕСЯТЬ ЛЕТ *СЕМИНАРА.* | change | `rail` 1953–1965 (the seminar as a bar, flags on "статья" and "совет") + `counter` "10 лет" |
| 8 | `school` | Слово вернули. Его ученик Ершов написал одну из первых в стране программирующих программ… | ВОКРУГ ВЫРОСЛА *ШКОЛА.* | structure | `tree`: the teacher, five students, one named |
| 9 | `end` | Ярлык отлепился. Схема осталась. | ЯРЛЫК ОТЛЕПИЛСЯ. *СХЕМА* ОСТАЛАСЬ. | identity | `card` (ЛЖЕНАУКА dissolves, НАУКА stays) + a scheme that keeps running |

Transition vocabulary: `cut` (the next step), `push-up` (the swipe of a feed: the next item), `dip` (a new chapter or theme), `punch` (the turn).

## Facts and sources

Every number in a statement or caption is tied to a fact with a source URL in `spec.json` (`facts`); `lint-spec` fails a shot whose numbers have none, and `post.md` lists the source pages. Where sources disagree, the film says less: no count of volumes of *Problems of Cybernetics* (one source says 29 under his editorship, another at least 6-7). Corrections from checking the first draft of the voice text: the film does not say he "invented schemes" (flowcharts of programs are Goldstine and von Neumann, 1947; Lyapunov's is the operator method and teaching it); it says "taught"; and it does not say cybernetics was "banned" (it was branded a pseudoscience), it says "считали лженаукой". The statement about Ershov is limited to what [the biography page](https://ru.wikipedia.org/wiki/Ершов,_Андрей_Петрович) supports: a pupil of Lyapunov and the author of one of the first programming programs for BESM and Strela. No portrait is used: the photograph that came with the brief carries a 1902 print date, nine years before he was born.

## Checks run

- `render/lint-spec.mjs`: 0 errors, 0 warnings.
- `render/qa.mjs` on the final render: frame 0 moves, the hook is on screen at 0 s, no still stretch over 2 s (longest 0.6 s), all boxes inside the safe zones, no overlaps, no text-fit warnings, word budget 2.16 words/s (statements + voice), loudness −14.4 LUFS and −2.8 dBTP.
- The first QA run found real problems and they were fixed: statements overlapping the HUD (the spec had no top margin for it), subtitles entering the button column and the bottom zone, the article title hidden behind the dictionary page, and a cover taken in the middle of a transition.
- Not checked by a machine, and left for a human: how the voice sounds (Edge TTS, free; for a commercial release re-record with `--engine openrouter`), whether each picture passes the label test (looked at by eye, frame by frame), the facts against their sources.
